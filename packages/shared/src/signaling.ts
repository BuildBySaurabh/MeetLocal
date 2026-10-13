import { z } from 'zod';
import { ROOM_ID_PATTERN } from './meeting.js';
import { displayNameSchema, participantIdSchema, participantSchema } from './participant.js';

/**
 * Signaling protocol v1.
 *
 * The signaling channel carries ONLY what is needed to set up a WebRTC connection:
 * room membership, SDP offers/answers and ICE candidates. It must never carry audio,
 * video, transcripts or AI prompts/responses.
 */

/** Hard cap enforced by the server on the raw WebSocket frame size. */
export const MAX_SIGNALING_MESSAGE_BYTES = 64 * 1024;
export const MAX_SDP_LENGTH = 32 * 1024;
export const MAX_ICE_CANDIDATE_LENGTH = 2 * 1024;
export const MAX_CHAT_LENGTH = 2000;
export const MAX_TRANSCRIPT_SEGMENT_LENGTH = 1000;

export const roomIdSchema = z.string().regex(ROOM_ID_PATTERN, 'Invalid room id');

const sdpSchema = z.object({
  type: z.enum(['offer', 'answer']),
  sdp: z.string().min(1).max(MAX_SDP_LENGTH),
});

const iceCandidateSchema = z.object({
  candidate: z.string().max(MAX_ICE_CANDIDATE_LENGTH),
  sdpMid: z.string().max(64).nullable().optional(),
  sdpMLineIndex: z.number().int().min(0).max(255).nullable().optional(),
  usernameFragment: z.string().max(256).nullable().optional(),
});

// ---------------------------------------------------------------------------
// Client -> server
// ---------------------------------------------------------------------------

export const joinMessageSchema = z.object({
  type: z.literal('join'),
  roomId: roomIdSchema,
  participantId: participantIdSchema,
  displayName: displayNameSchema,
  /** "create" makes the room if absent; "join" fails with room-not-found if absent. */
  intent: z.enum(['create', 'join']),
});

export const offerMessageSchema = z.object({
  type: z.literal('offer'),
  to: participantIdSchema,
  description: sdpSchema.extend({ type: z.literal('offer') }),
});

export const answerMessageSchema = z.object({
  type: z.literal('answer'),
  to: participantIdSchema,
  description: sdpSchema.extend({ type: z.literal('answer') }),
});

export const iceCandidateMessageSchema = z.object({
  type: z.literal('ice-candidate'),
  to: participantIdSchema,
  candidate: iceCandidateSchema,
});

export const leaveMessageSchema = z.object({
  type: z.literal('leave'),
});

/**
 * In-meeting chat. NOTE: chat text travels through the signaling server (in memory only, never
 * stored or logged) because the brief asks for chat over the existing signaling connection.
 * Newlines and tabs are allowed; other control characters are rejected.
 */
export const chatTextSchema = z
  .string()
  .trim()
  .min(1, 'Message is empty')
  .max(MAX_CHAT_LENGTH, 'Message is too long')
  // eslint-disable-next-line no-control-regex
  .regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+$/, 'Message contains control characters');

export const chatMessageSchema = z.object({
  type: z.literal('chat'),
  text: chatTextSchema,
});

/** What others should show for this participant (mic/camera/screen). Contains no media. */
export const mediaStateSchema = z.object({
  micEnabled: z.boolean(),
  cameraEnabled: z.boolean(),
  screenSharing: z.boolean(),
});

export type MediaState = z.infer<typeof mediaStateSchema>;

export const mediaStateMessageSchema = mediaStateSchema.extend({
  type: z.literal('media-state'),
});

/**
 * Shared meeting notes (opt-in). Each participant transcribes their OWN microphone on their own
 * device and may choose to send the resulting text lines to the others. Audio never leaves the
 * device. Like chat, the text passes through the server in memory only and is never stored or logged.
 */
export const transcriptSharingMessageSchema = z.object({
  type: z.literal('transcript-sharing'),
  enabled: z.boolean(),
});

export const transcriptSegmentMessageSchema = z.object({
  type: z.literal('transcript-segment'),
  text: chatTextSchema.pipe(z.string().max(MAX_TRANSCRIPT_SEGMENT_LENGTH)),
});

export const clientMessageSchema = z.discriminatedUnion('type', [
  joinMessageSchema,
  offerMessageSchema,
  answerMessageSchema,
  iceCandidateMessageSchema,
  leaveMessageSchema,
  chatMessageSchema,
  mediaStateMessageSchema,
  transcriptSharingMessageSchema,
  transcriptSegmentMessageSchema,
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type JoinMessage = z.infer<typeof joinMessageSchema>;

// ---------------------------------------------------------------------------
// Server -> client
// ---------------------------------------------------------------------------

export const SIGNALING_ERROR_CODES = [
  'invalid-message',
  'message-too-large',
  'room-not-found',
  'room-full',
  'duplicate-participant',
  'already-joined',
  'not-in-room',
  'unknown-recipient',
  'rate-limited',
  'origin-not-allowed',
  'server-error',
] as const;

export type SignalingErrorCode = (typeof SIGNALING_ERROR_CODES)[number];

export const serverMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('joined'),
    roomId: roomIdSchema,
    selfId: participantIdSchema,
    /** Participants already in the room (excluding self). */
    participants: z.array(participantSchema),
  }),
  z.object({ type: z.literal('participant-joined'), participant: participantSchema }),
  z.object({ type: z.literal('participant-left'), participantId: participantIdSchema }),
  z.object({
    type: z.literal('offer'),
    from: participantIdSchema,
    description: sdpSchema.extend({ type: z.literal('offer') }),
  }),
  z.object({
    type: z.literal('answer'),
    from: participantIdSchema,
    description: sdpSchema.extend({ type: z.literal('answer') }),
  }),
  z.object({
    type: z.literal('ice-candidate'),
    from: participantIdSchema,
    candidate: iceCandidateSchema,
  }),
  z.object({
    type: z.literal('chat'),
    from: participantIdSchema,
    text: chatTextSchema,
    /** Server clock, milliseconds since epoch. */
    sentAt: z.number().int().nonnegative(),
  }),
  mediaStateSchema.extend({ type: z.literal('media-state'), from: participantIdSchema }),
  z.object({ type: z.literal('transcript-sharing'), from: participantIdSchema, enabled: z.boolean() }),
  z.object({
    type: z.literal('transcript-segment'),
    from: participantIdSchema,
    text: z.string().min(1).max(MAX_TRANSCRIPT_SEGMENT_LENGTH),
    /** Server clock, milliseconds since epoch. */
    sentAt: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('error'),
    code: z.enum(SIGNALING_ERROR_CODES),
    message: z.string(),
  }),
]);

export type ServerMessage = z.infer<typeof serverMessageSchema>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Parses and validates a raw WebSocket text frame sent by a client. */
export function parseClientMessage(raw: string): ParseResult<ClientMessage> {
  if (raw.length > MAX_SIGNALING_MESSAGE_BYTES) return { ok: false, error: 'Message too large' };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Message is not valid JSON' };
  }
  const result = clientMessageSchema.safeParse(json);
  if (!result.success) {
    // Report only the shape problem, never echo the message body back or into logs.
    const issue = result.error.issues[0];
    return { ok: false, error: issue ? `${issue.path.join('.') || 'message'}: ${issue.message}` : 'Invalid message' };
  }
  return { ok: true, value: result.data };
}

/** Parses and validates a raw WebSocket text frame sent by the server. */
export function parseServerMessage(raw: string): ParseResult<ServerMessage> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Message is not valid JSON' };
  }
  const result = serverMessageSchema.safeParse(json);
  return result.success ? { ok: true, value: result.data } : { ok: false, error: 'Unexpected server message' };
}
