import { MAX_PARTICIPANTS_PER_ROOM, type JoinMessage, type SignalingErrorCode } from '@meetlocal/shared';
import type { MemberHandle, Room, RoomMember } from './room.types.js';

export interface RoomManagerOptions {
  maxRooms: number;
  emptyRoomTtlMs: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

export type JoinResult =
  | { ok: true; self: RoomMember; others: RoomMember[]; created: boolean }
  | { ok: false; code: SignalingErrorCode; message: string };

/**
 * In-memory room state. Rooms are NOT persisted: restarting the signaling server
 * ends every meeting's signaling state.
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly now: () => number;

  constructor(private readonly options: RoomManagerOptions) {
    this.now = options.now ?? Date.now;
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  join(message: JoinMessage, handle: MemberHandle): JoinResult {
    let room = this.rooms.get(message.roomId);
    let created = false;

    if (!room) {
      if (message.intent === 'join') {
        return {
          ok: false,
          code: 'room-not-found',
          message: 'This meeting does not exist or has ended.',
        };
      }
      if (this.rooms.size >= this.options.maxRooms) {
        return {
          ok: false,
          code: 'server-error',
          message: 'The server is at capacity. Please try again later.',
        };
      }
      room = { id: message.roomId, createdAt: this.now(), emptySince: null, members: new Map() };
      this.rooms.set(room.id, room);
      created = true;
    }

    if (room.members.has(message.participantId)) {
      return {
        ok: false,
        code: 'duplicate-participant',
        message: 'This participant is already connected to the meeting.',
      };
    }
    if (room.members.size >= MAX_PARTICIPANTS_PER_ROOM) {
      return { ok: false, code: 'room-full', message: 'This meeting is full.' };
    }

    const others = [...room.members.values()];
    const self: RoomMember = {
      participant: { id: message.participantId, displayName: message.displayName },
      handle,
    };
    room.members.set(self.participant.id, self);
    room.emptySince = null;
    return { ok: true, self, others, created };
  }

  /**
   * Removes a member. Returns the remaining members to notify, or null when the
   * participant was not (or no longer) a member with this handle.
   */
  leave(roomId: string, participantId: string, handle: MemberHandle): RoomMember[] | null {
    const room = this.rooms.get(roomId);
    const member = room?.members.get(participantId);
    if (!room || !member || member.handle !== handle) return null;

    room.members.delete(participantId);
    if (room.members.size === 0) room.emptySince = this.now();
    return [...room.members.values()];
  }

  getMember(roomId: string, participantId: string): RoomMember | undefined {
    return this.rooms.get(roomId)?.members.get(participantId);
  }

  /** Everyone in the room except the given participant (for room-wide messages). */
  getOtherMembers(roomId: string, participantId: string): RoomMember[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return [...room.members.values()].filter((member) => member.participant.id !== participantId);
  }

  /** Deletes rooms that have been empty longer than the TTL. Returns how many were removed. */
  sweep(): number {
    const cutoff = this.now() - this.options.emptyRoomTtlMs;
    let removed = 0;
    for (const [id, room] of this.rooms) {
      if (room.emptySince !== null && room.emptySince <= cutoff) {
        this.rooms.delete(id);
        removed += 1;
      }
    }
    return removed;
  }
}
