import {
  MAX_SIGNALING_MESSAGE_BYTES,
  parseClientMessage,
  type ServerMessage,
  type SignalingErrorCode,
} from '@meetlocal/shared';
import type { RoomManager } from '../rooms/roomManager.js';
import type { MemberHandle } from '../rooms/room.types.js';
import { type TokenBucket } from '../security/rateLimiter.js';

/** Per-connection state. One session corresponds to one WebSocket. */
export interface ClientSession {
  handle: MemberHandle;
  limiter: TokenBucket;
  roomId: string | null;
  participantId: string | null;
  /** True once this connection has joined a room. A connection joins at most once (see `join`). */
  hasJoined?: boolean;
  /** Stricter limit for chat, which carries user text. Optional so simple callers need not provide it. */
  chatLimiter?: TokenBucket;
  /** Limit for shared transcript lines. */
  notesLimiter?: TokenBucket;
}

export interface MessageRouter {
  handleMessage(session: ClientSession, raw: string): void;
  handleDisconnect(session: ClientSession): void;
}

function sendError(session: ClientSession, code: SignalingErrorCode, message: string): void {
  session.handle.send({ type: 'error', code, message });
}

/**
 * Routes validated signaling messages. Key invariants:
 *  - every inbound frame is validated before use;
 *  - the sender identity (`from`) is set by the server from session state, never by the client;
 *  - messages are only relayed to a participant in the sender's own room.
 * Message bodies are never logged.
 */
export function createMessageRouter(rooms: RoomManager, now: () => number = Date.now): MessageRouter {
  function handleDisconnect(session: ClientSession): void {
    const { roomId, participantId } = session;
    if (roomId === null || participantId === null) return;
    session.roomId = null;
    session.participantId = null;

    const remaining = rooms.leave(roomId, participantId, session.handle);
    if (!remaining) return;
    const notice: ServerMessage = { type: 'participant-left', participantId };
    for (const member of remaining) member.handle.send(notice);
  }

  function handleMessage(session: ClientSession, raw: string): void {
    if (raw.length > MAX_SIGNALING_MESSAGE_BYTES) {
      sendError(session, 'message-too-large', 'Message is too large.');
      return;
    }
    if (!session.limiter.tryConsume()) {
      sendError(session, 'rate-limited', 'Too many messages. Slow down.');
      return;
    }

    const parsed = parseClientMessage(raw);
    if (!parsed.ok) {
      sendError(session, 'invalid-message', parsed.error);
      return;
    }
    const message = parsed.value;

    switch (message.type) {
      case 'join': {
        // One join per connection, even after leaving: otherwise a single socket could create rooms
        // at the full message rate and exhaust the room limit. Clients reconnect to join again.
        if (session.roomId !== null || session.hasJoined) {
          sendError(session, 'already-joined', 'This connection has already joined a meeting.');
          return;
        }
        const result = rooms.join(message, session.handle);
        if (!result.ok) {
          sendError(session, result.code, result.message);
          return;
        }
        session.roomId = message.roomId;
        session.participantId = message.participantId;
        session.hasJoined = true;

        session.handle.send({
          type: 'joined',
          roomId: message.roomId,
          selfId: message.participantId,
          participants: result.others.map((member) => member.participant),
        });
        for (const member of result.others) {
          member.handle.send({ type: 'participant-joined', participant: result.self.participant });
          // Tell the newcomer who is already sharing their transcript so the UI can say so.
          if (member.sharingTranscript) {
            session.handle.send({ type: 'transcript-sharing', from: member.participant.id, enabled: true });
          }
        }
        return;
      }

      case 'offer':
      case 'answer':
      case 'ice-candidate': {
        const { roomId, participantId } = session;
        if (roomId === null || participantId === null) {
          sendError(session, 'not-in-room', 'Join a meeting before sending signaling messages.');
          return;
        }
        if (message.to === participantId) {
          sendError(session, 'invalid-message', 'Cannot send a signaling message to yourself.');
          return;
        }
        const target = rooms.getMember(roomId, message.to);
        if (!target) {
          sendError(session, 'unknown-recipient', 'That participant is not in this meeting.');
          return;
        }
        // Rebuild the outbound message explicitly so only validated fields are relayed.
        if (message.type === 'offer') {
          target.handle.send({ type: 'offer', from: participantId, description: message.description });
        } else if (message.type === 'answer') {
          target.handle.send({ type: 'answer', from: participantId, description: message.description });
        } else {
          target.handle.send({ type: 'ice-candidate', from: participantId, candidate: message.candidate });
        }
        return;
      }

      case 'chat':
      case 'media-state': {
        const { roomId, participantId } = session;
        if (roomId === null || participantId === null) {
          sendError(session, 'not-in-room', 'Join a meeting before sending messages.');
          return;
        }
        if (message.type === 'chat' && session.chatLimiter && !session.chatLimiter.tryConsume()) {
          sendError(session, 'rate-limited', 'You are sending messages too quickly.');
          return;
        }
        // Room-wide relay to everyone except the sender. Content is never stored or logged.
        const others = rooms.getOtherMembers(roomId, participantId);
        const outbound: ServerMessage =
          message.type === 'chat'
            ? { type: 'chat', from: participantId, text: message.text, sentAt: now() }
            : {
                type: 'media-state',
                from: participantId,
                micEnabled: message.micEnabled,
                cameraEnabled: message.cameraEnabled,
                screenSharing: message.screenSharing,
              };
        for (const member of others) member.handle.send(outbound);
        return;
      }

      case 'transcript-sharing':
      case 'transcript-segment': {
        const { roomId, participantId } = session;
        if (roomId === null || participantId === null) {
          sendError(session, 'not-in-room', 'Join a meeting before sending messages.');
          return;
        }
        const self = rooms.getMember(roomId, participantId);
        if (!self) return;
        const others = rooms.getOtherMembers(roomId, participantId);
        if (message.type === 'transcript-sharing') {
          self.sharingTranscript = message.enabled;
          for (const member of others) {
            member.handle.send({ type: 'transcript-sharing', from: participantId, enabled: message.enabled });
          }
          return;
        }
        // Lines are only relayed while the sender has announced sharing, so nobody can receive text
        // from someone who did not tell them (and the UI) that they are sharing.
        if (!self.sharingTranscript) {
          sendError(session, 'invalid-message', 'Turn on transcript sharing before sending transcript lines.');
          return;
        }
        if (session.notesLimiter && !session.notesLimiter.tryConsume()) {
          sendError(session, 'rate-limited', 'Transcript lines are being sent too quickly.');
          return;
        }
        for (const member of others) {
          member.handle.send({ type: 'transcript-segment', from: participantId, text: message.text, sentAt: now() });
        }
        return;
      }

      case 'leave':
        handleDisconnect(session);
        return;
    }
  }

  return { handleMessage, handleDisconnect };
}
