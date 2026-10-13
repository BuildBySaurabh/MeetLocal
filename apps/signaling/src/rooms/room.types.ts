import type { Participant, ServerMessage } from '@meetlocal/shared';

/** Transport-agnostic handle so room logic can be tested without real sockets. */
export interface MemberHandle {
  send(message: ServerMessage): void;
}

export interface RoomMember {
  participant: Participant;
  handle: MemberHandle;
  /** True while this participant has chosen to share their own transcript lines with the room. */
  sharingTranscript?: boolean;
}

export interface Room {
  id: string;
  createdAt: number;
  /** Timestamp when the last member left, or null while the room has members. */
  emptySince: number | null;
  members: Map<string, RoomMember>;
}
