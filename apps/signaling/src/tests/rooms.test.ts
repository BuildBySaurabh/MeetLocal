import { MAX_PARTICIPANTS_PER_ROOM } from '@meetlocal/shared';
import { describe, expect, it } from 'vitest';
import type { JoinMessage, ServerMessage } from '@meetlocal/shared';
import { RoomManager } from '../rooms/roomManager.js';
import type { MemberHandle } from '../rooms/room.types.js';

const ROOM = 'A'.repeat(22);
const P1 = 'p'.repeat(16) + '1';
const P2 = 'p'.repeat(16) + '2';

function handle(): MemberHandle & { sent: ServerMessage[] } {
  const sent: ServerMessage[] = [];
  return { sent, send: (m) => void sent.push(m) };
}

function join(participantId: string, intent: 'create' | 'join' = 'join', roomId = ROOM): JoinMessage {
  return { type: 'join', roomId, participantId, displayName: 'Test', intent };
}

function makeManager(opts: { now?: () => number; maxRooms?: number } = {}) {
  return new RoomManager({ maxRooms: opts.maxRooms ?? 10, emptyRoomTtlMs: 60_000, now: opts.now });
}

describe('RoomManager', () => {
  it('creates a room on a create-intent join', () => {
    const rooms = makeManager();
    const result = rooms.join(join(P1, 'create'), handle());
    expect(result.ok && result.created).toBe(true);
    expect(rooms.roomCount).toBe(1);
  });

  it('rejects a join-intent for a room that does not exist', () => {
    const rooms = makeManager();
    const result = rooms.join(join(P1, 'join'), handle());
    expect(result).toMatchObject({ ok: false, code: 'room-not-found' });
    expect(rooms.roomCount).toBe(0);
  });

  it('lets a second participant join and reports existing members', () => {
    const rooms = makeManager();
    rooms.join(join(P1, 'create'), handle());
    const result = rooms.join(join(P2), handle());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.others.map((m) => m.participant.id)).toEqual([P1]);
  });

  it('rejects duplicate participant ids', () => {
    const rooms = makeManager();
    rooms.join(join(P1, 'create'), handle());
    expect(rooms.join(join(P1), handle())).toMatchObject({ ok: false, code: 'duplicate-participant' });
  });

  it('enforces the room capacity', () => {
    const rooms = makeManager();
    rooms.join(join(P1, 'create'), handle());
    for (let i = 2; i <= MAX_PARTICIPANTS_PER_ROOM; i += 1) {
      expect(rooms.join(join('p'.repeat(16) + String(i)), handle())).toMatchObject({ ok: true });
    }
    expect(rooms.join(join('q'.repeat(17)), handle())).toMatchObject({ ok: false, code: 'room-full' });
  });

  it('enforces the maximum number of rooms', () => {
    const rooms = makeManager({ maxRooms: 1 });
    rooms.join(join(P1, 'create', 'A'.repeat(22)), handle());
    const result = rooms.join(join(P2, 'create', 'B'.repeat(22)), handle());
    expect(result).toMatchObject({ ok: false, code: 'server-error' });
  });

  it('returns remaining members on leave and ignores unknown leavers', () => {
    const rooms = makeManager();
    const h1 = handle();
    const h2 = handle();
    rooms.join(join(P1, 'create'), h1);
    rooms.join(join(P2), h2);
    expect(rooms.leave(ROOM, P1, h1)?.map((m) => m.participant.id)).toEqual([P2]);
    expect(rooms.leave(ROOM, P1, h1)).toBeNull();
  });

  it('does not let a different handle remove a member', () => {
    const rooms = makeManager();
    rooms.join(join(P1, 'create'), handle());
    expect(rooms.leave(ROOM, P1, handle())).toBeNull();
    expect(rooms.getMember(ROOM, P1)).toBeDefined();
  });

  it('keeps an empty room joinable until the TTL expires, then removes it', () => {
    let now = 1_000;
    const rooms = makeManager({ now: () => now });
    const h1 = handle();
    rooms.join(join(P1, 'create'), h1);
    rooms.leave(ROOM, P1, h1);

    now += 30_000;
    expect(rooms.sweep()).toBe(0);
    expect(rooms.join(join(P2), handle()).ok).toBe(true);

    const h2 = rooms.getMember(ROOM, P2)!.handle;
    rooms.leave(ROOM, P2, h2);
    now += 61_000;
    expect(rooms.sweep()).toBe(1);
    expect(rooms.roomCount).toBe(0);
    expect(rooms.join(join(P1, 'join'), handle())).toMatchObject({ ok: false, code: 'room-not-found' });
  });
});
