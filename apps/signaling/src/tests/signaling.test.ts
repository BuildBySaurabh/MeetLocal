import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { parseClientMessage, parseServerMessage, type ClientMessage, type ServerMessage } from '@meetlocal/shared';
import { loadConfig, type SignalingConfig } from '../config.js';
import { RoomManager } from '../rooms/roomManager.js';
import { createMessageRouter, type ClientSession } from '../signaling/messageRouter.js';
import { ConnectionLimiter, TokenBucket } from '../security/rateLimiter.js';
import { isOriginAllowed } from '../security/originValidator.js';
import { createSignalingServer, type SignalingServer } from '../server.js';

const ROOM = 'R'.repeat(22);
const A = 'a'.repeat(16) + 'A';
const B = 'b'.repeat(16) + 'B';
const SDP = { type: 'offer' as const, sdp: 'v=0\r\n' };

describe('message validation', () => {
  const valid: ClientMessage = {
    type: 'join',
    roomId: ROOM,
    participantId: A,
    displayName: 'Alice',
    intent: 'create',
  };

  it('accepts a valid join message', () => {
    expect(parseClientMessage(JSON.stringify(valid)).ok).toBe(true);
  });

  it.each([
    ['non-JSON', 'not json'],
    ['unknown type', JSON.stringify({ type: 'hack' })],
    ['short room id', JSON.stringify({ ...valid, roomId: 'short' })],
    ['room id with bad characters', JSON.stringify({ ...valid, roomId: '!'.repeat(22) })],
    ['empty display name', JSON.stringify({ ...valid, displayName: '   ' })],
    ['control characters in name', JSON.stringify({ ...valid, displayName: 'a\u0000b' })],
    ['overlong display name', JSON.stringify({ ...valid, displayName: 'x'.repeat(41) })],
    ['bad intent', JSON.stringify({ ...valid, intent: 'admin' })],
    ['offer without sdp', JSON.stringify({ type: 'offer', to: B, description: { type: 'offer' } })],
    ['answer carrying an offer description', JSON.stringify({ type: 'answer', to: B, description: SDP })],
  ])('rejects %s', (_label, raw) => {
    expect(parseClientMessage(raw).ok).toBe(false);
  });

  it('rejects oversized frames', () => {
    expect(parseClientMessage('x'.repeat(70 * 1024))).toEqual({ ok: false, error: 'Message too large' });
  });

  it('rejects an oversized SDP', () => {
    const raw = JSON.stringify({ type: 'offer', to: B, description: { type: 'offer', sdp: 'x'.repeat(40_000) } });
    expect(parseClientMessage(raw).ok).toBe(false);
  });

  it('does not echo message contents in validation errors', () => {
    const result = parseClientMessage(JSON.stringify({ ...valid, displayName: '', secret: 'TOPSECRET' }));
    expect(JSON.stringify(result)).not.toContain('TOPSECRET');
  });

  it('validates server messages', () => {
    expect(parseServerMessage(JSON.stringify({ type: 'error', code: 'room-full', message: 'x' })).ok).toBe(true);
    expect(parseServerMessage(JSON.stringify({ type: 'nope' })).ok).toBe(false);
  });
});

function makeSession() {
  const sent: ServerMessage[] = [];
  const session: ClientSession = {
    handle: { send: (m) => void sent.push(m) },
    limiter: new TokenBucket(1000, 1000),
    roomId: null,
    participantId: null,
  };
  return { session, sent };
}

function send(router: ReturnType<typeof createMessageRouter>, session: ClientSession, message: unknown) {
  router.handleMessage(session, JSON.stringify(message));
}

const join = (participantId: string, intent: 'create' | 'join' = 'join', roomId = ROOM) => ({
  type: 'join',
  roomId,
  participantId,
  displayName: participantId.slice(-1),
  intent,
});

describe('message router', () => {
  function setup() {
    const rooms = new RoomManager({ maxRooms: 10, emptyRoomTtlMs: 60_000 });
    const router = createMessageRouter(rooms);
    return { rooms, router, a: makeSession(), b: makeSession() };
  }

  it('joins, notifies the existing participant and lists peers to the newcomer', () => {
    const { router, a, b } = setup();
    send(router, a.session, join(A, 'create'));
    expect(a.sent[0]).toMatchObject({ type: 'joined', selfId: A, participants: [] });

    send(router, b.session, join(B));
    expect(b.sent[0]).toMatchObject({ type: 'joined', selfId: B });
    expect(a.sent[1]).toMatchObject({ type: 'participant-joined', participant: { id: B } });
  });

  it('returns room-not-found for an unknown room', () => {
    const { router, a } = setup();
    send(router, a.session, join(A));
    expect(a.sent[0]).toMatchObject({ type: 'error', code: 'room-not-found' });
  });

  it('rejects a second join on the same connection', () => {
    const { router, a } = setup();
    send(router, a.session, join(A, 'create'));
    send(router, a.session, join(A, 'create'));
    expect(a.sent[1]).toMatchObject({ type: 'error', code: 'already-joined' });
  });

  it('relays offers with a server-assigned sender id', () => {
    const { router, a, b } = setup();
    send(router, a.session, join(A, 'create'));
    send(router, b.session, join(B));
    // A forged "from" must be ignored: validation strips unknown keys and the server sets it.
    send(router, a.session, { type: 'offer', to: B, from: 'forged-forged-forged', description: SDP });
    const relayed = b.sent.at(-1);
    expect(relayed).toMatchObject({ type: 'offer', from: A });
    expect(JSON.stringify(relayed)).not.toContain('forged');
  });

  it('relays answers and ICE candidates', () => {
    const { router, a, b } = setup();
    send(router, a.session, join(A, 'create'));
    send(router, b.session, join(B));
    send(router, b.session, { type: 'answer', to: A, description: { type: 'answer', sdp: 'v=0' } });
    send(router, a.session, {
      type: 'ice-candidate',
      to: B,
      candidate: { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 },
    });
    expect(a.sent.at(-1)).toMatchObject({ type: 'answer', from: B });
    expect(b.sent.at(-1)).toMatchObject({ type: 'ice-candidate', from: A });
  });

  it('refuses signaling before joining', () => {
    const { router, a } = setup();
    send(router, a.session, { type: 'offer', to: B, description: SDP });
    expect(a.sent[0]).toMatchObject({ type: 'error', code: 'not-in-room' });
  });

  it('does not relay to participants outside the sender room', () => {
    const { router, a, b } = setup();
    send(router, a.session, join(A, 'create', 'X'.repeat(22)));
    send(router, b.session, join(B, 'create', 'Y'.repeat(22)));
    send(router, a.session, { type: 'offer', to: B, description: SDP });
    expect(a.sent.at(-1)).toMatchObject({ type: 'error', code: 'unknown-recipient' });
    expect(b.sent.some((m) => m.type === 'offer')).toBe(false);
  });

  it('rejects signaling to self', () => {
    const { router, a } = setup();
    send(router, a.session, join(A, 'create'));
    send(router, a.session, { type: 'offer', to: A, description: SDP });
    expect(a.sent.at(-1)).toMatchObject({ type: 'error', code: 'invalid-message' });
  });

  it('notifies the peer when a participant leaves or disconnects', () => {
    const { router, a, b } = setup();
    send(router, a.session, join(A, 'create'));
    send(router, b.session, join(B));
    send(router, a.session, { type: 'leave' });
    expect(b.sent.at(-1)).toEqual({ type: 'participant-left', participantId: A });
    router.handleDisconnect(b.session);
    router.handleDisconnect(b.session); // idempotent
  });

  it('reports invalid messages without crashing', () => {
    const { router, a } = setup();
    router.handleMessage(a.session, '{bad');
    expect(a.sent[0]).toMatchObject({ type: 'error', code: 'invalid-message' });
  });

  it('rate limits a flooding connection', () => {
    const { router, a } = setup();
    a.session.limiter = new TokenBucket(3, 0);
    for (let i = 0; i < 5; i += 1) send(router, a.session, { type: 'leave' });
    expect(a.sent.filter((m) => m.type === 'error' && m.code === 'rate-limited').length).toBe(2);
  });
});

describe('chat and media-state relay', () => {
  function setup() {
    const rooms = new RoomManager({ maxRooms: 10, emptyRoomTtlMs: 60_000 });
    const router = createMessageRouter(rooms, () => 1_700_000_000_000);
    return { rooms, router, a: makeSession(), b: makeSession() };
  }

  it('relays chat to the other participant with a server-assigned sender and timestamp, and not back to the sender', () => {
    const { router, a, b } = setup();
    send(router, a.session, join(A, 'create'));
    send(router, b.session, join(B));
    const aBefore = a.sent.length;

    send(router, a.session, { type: 'chat', text: '  hello <b>there</b>  ', from: 'forged-forged-forged' });
    expect(b.sent.at(-1)).toEqual({ type: 'chat', from: A, text: 'hello <b>there</b>', sentAt: 1_700_000_000_000 });
    expect(a.sent.length).toBe(aBefore);
  });

  it('allows multi-line chat but rejects empty, oversized and control-character messages', () => {
    const { router, a, b } = setup();
    send(router, a.session, join(A, 'create'));
    send(router, b.session, join(B));

    send(router, a.session, { type: 'chat', text: 'line one\nline two' });
    expect(b.sent.at(-1)).toMatchObject({ type: 'chat', text: 'line one\nline two' });

    const before = b.sent.length;
    for (const text of ['', '   ', 'x'.repeat(2001), 'bad\u0000char', 'bell\u0007']) {
      send(router, a.session, { type: 'chat', text });
      expect(a.sent.at(-1)).toMatchObject({ type: 'error', code: 'invalid-message' });
    }
    expect(b.sent.length).toBe(before);
  });

  it('requires joining first and never reaches other rooms', () => {
    const { router, a, b } = setup();
    send(router, a.session, { type: 'chat', text: 'hi' });
    expect(a.sent[0]).toMatchObject({ type: 'error', code: 'not-in-room' });

    send(router, a.session, join(A, 'create', 'X'.repeat(22)));
    send(router, b.session, join(B, 'create', 'Y'.repeat(22)));
    send(router, a.session, { type: 'chat', text: 'private' });
    expect(b.sent.some((m) => m.type === 'chat')).toBe(false);
  });

  it('relays media state (mic, camera, screen sharing) with a server-assigned sender', () => {
    const { router, a, b } = setup();
    send(router, a.session, join(A, 'create'));
    send(router, b.session, join(B));
    send(router, a.session, { type: 'media-state', micEnabled: false, cameraEnabled: true, screenSharing: true });
    expect(b.sent.at(-1)).toEqual({
      type: 'media-state',
      from: A,
      micEnabled: false,
      cameraEnabled: true,
      screenSharing: true,
    });
  });

  it('rejects malformed media state', () => {
    const { router, a } = setup();
    send(router, a.session, join(A, 'create'));
    send(router, a.session, { type: 'media-state', micEnabled: 'yes', cameraEnabled: true, screenSharing: false });
    expect(a.sent.at(-1)).toMatchObject({ type: 'error', code: 'invalid-message' });
  });
});

describe('rate limiting primitives', () => {
  it('refills the token bucket over time', () => {
    let now = 0;
    const bucket = new TokenBucket(2, 1, () => now);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);
    now += 1000;
    expect(bucket.tryConsume()).toBe(true);
  });

  it('limits concurrent connections and attempts per IP', () => {
    let now = 0;
    const limiter = new ConnectionLimiter({ maxConcurrentPerIp: 2, maxAttemptsPerMinute: 3, now: () => now });
    expect(limiter.tryAcquire('1.1.1.1')).toBe(true);
    expect(limiter.tryAcquire('1.1.1.1')).toBe(true);
    expect(limiter.tryAcquire('1.1.1.1')).toBe(false); // concurrent cap
    limiter.release('1.1.1.1');
    expect(limiter.tryAcquire('1.1.1.1')).toBe(true);
    limiter.release('1.1.1.1');
    expect(limiter.tryAcquire('1.1.1.1')).toBe(false); // attempts-per-minute cap
    now += 61_000;
    expect(limiter.tryAcquire('1.1.1.1')).toBe(true);
  });
});

describe('origin validation', () => {
  const allowed = ['http://localhost:5173', 'https://meet.example.com'];

  it('accepts allow-listed origins', () => {
    expect(isOriginAllowed('http://localhost:5173', allowed, true)).toBe(true);
    expect(isOriginAllowed('https://MEET.example.com/', allowed, true)).toBe(true);
  });

  it('rejects other origins', () => {
    expect(isOriginAllowed('https://evil.example', allowed, false)).toBe(false);
  });

  it('allows a missing origin only outside production', () => {
    expect(isOriginAllowed(undefined, allowed, false)).toBe(true);
    expect(isOriginAllowed(undefined, allowed, true)).toBe(false);
  });
});

describe('config', () => {
  it('uses the platform PORT variable unless SIGNALING_PORT is set', () => {
    expect(loadConfig({ PORT: '10000' }).port).toBe(10000);
    expect(loadConfig({ PORT: '10000', SIGNALING_PORT: '9000' }).port).toBe(9000);
    expect(loadConfig({}).port).toBe(8787);
  });

  it('requires ALLOWED_ORIGINS in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/ALLOWED_ORIGINS/);
  });

  it('uses a localhost origin by default in development', () => {
    expect(loadConfig({}).allowedOrigins).toEqual(['http://localhost:5173']);
  });
});

describe('real WebSocket server', () => {
  let server: SignalingServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  async function start(overrides: Partial<SignalingConfig> = {}) {
    const config = { ...loadConfig({ SIGNALING_HOST: '127.0.0.1' }), port: 0, host: '127.0.0.1', ...overrides };
    server = createSignalingServer(config);
    return server.listen();
  }

  function connect(port: number, origin = 'http://localhost:5173') {
    return new WebSocket(`ws://127.0.0.1:${port}`, { origin });
  }

  function nextMessage(ws: WebSocket): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      ws.once('message', (data) => {
        const parsed = parseServerMessage(data.toString());
        if (parsed.ok) resolve(parsed.value);
        else reject(new Error(parsed.error));
      });
      ws.once('error', reject);
    });
  }

  it('relays an offer between two real sockets', async () => {
    const port = await start();
    const a = connect(port);
    const b = connect(port);
    await Promise.all([new Promise((r) => a.once('open', r)), new Promise((r) => b.once('open', r))]);

    const aJoined = nextMessage(a);
    a.send(JSON.stringify(join(A, 'create')));
    expect(await aJoined).toMatchObject({ type: 'joined' });

    const aNotified = nextMessage(a);
    const bJoined = nextMessage(b);
    b.send(JSON.stringify(join(B)));
    expect(await bJoined).toMatchObject({ type: 'joined', participants: [{ id: A }] });
    expect(await aNotified).toMatchObject({ type: 'participant-joined', participant: { id: B } });

    const bGotOffer = nextMessage(b);
    a.send(JSON.stringify({ type: 'offer', to: B, description: SDP }));
    expect(await bGotOffer).toMatchObject({ type: 'offer', from: A });

    const aGotLeft = nextMessage(a);
    b.close();
    expect(await aGotLeft).toEqual({ type: 'participant-left', participantId: B });
    a.close();
  });

  it('rejects connections from disallowed origins', async () => {
    const port = await start();
    const ws = connect(port, 'https://evil.example');
    const outcome = await new Promise<string>((resolve) => {
      ws.once('open', () => resolve('open'));
      ws.once('unexpected-response', (_req, res) => resolve(String(res.statusCode)));
      ws.once('error', () => resolve('error'));
    });
    expect(['403', 'error']).toContain(outcome);
    expect(outcome).not.toBe('open');
  });

  it('closes connections that never join', async () => {
    const port = await start({ joinTimeoutMs: 100 });
    const ws = connect(port);
    const code = await new Promise<number>((resolve) => ws.once('close', (c) => resolve(c)));
    expect(code).toBe(4408);
  });

  it('serves a health check', async () => {
    const port = await start();
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    expect(await response.json()).toEqual({ status: 'ok' });
  });
});

describe('abuse limits', () => {
  it('lets a connection join only once, even after leaving, so one socket cannot churn through rooms', () => {
    const rooms = new RoomManager({ maxRooms: 5, emptyRoomTtlMs: 60_000 });
    const router = createMessageRouter(rooms);
    const a = makeSession();
    send(router, a.session, join(A, 'create'));
    send(router, a.session, { type: 'leave' });
    send(router, a.session, { ...join(A, 'create'), roomId: 'Q'.repeat(22) });
    expect(a.sent.at(-1)).toMatchObject({ type: 'error', code: 'already-joined' });
    expect(rooms.roomCount).toBe(1);
  });

  it('rate limits chat more strictly than other messages but still relays media-state', () => {
    const rooms = new RoomManager({ maxRooms: 5, emptyRoomTtlMs: 60_000 });
    const router = createMessageRouter(rooms);
    const a = makeSession();
    const b = makeSession();
    a.session.chatLimiter = new TokenBucket(3, 0.0001);
    send(router, a.session, join(A, 'create'));
    send(router, b.session, join(B));
    for (let i = 0; i < 3; i += 1) send(router, a.session, { type: 'chat', text: `m${i}` });
    const delivered = b.sent.filter((m) => m.type === 'chat').length;
    expect(delivered).toBe(3);
    send(router, a.session, { type: 'chat', text: 'too many' });
    expect(a.sent.at(-1)).toMatchObject({ type: 'error', code: 'rate-limited' });
    expect(b.sent.filter((m) => m.type === 'chat')).toHaveLength(3);
    send(router, a.session, { type: 'media-state', micEnabled: false, cameraEnabled: true, screenSharing: false });
    expect(b.sent.at(-1)).toMatchObject({ type: 'media-state', micEnabled: false });
  });
});

describe('shared transcript lines', () => {
  function setupRoom() {
    const rooms = new RoomManager({ maxRooms: 5, emptyRoomTtlMs: 60_000 });
    const router = createMessageRouter(rooms);
    const a = makeSession();
    const b = makeSession();
    send(router, a.session, join(A, 'create'));
    send(router, b.session, join(B));
    return { rooms, router, a, b };
  }

  it('relays lines to the others, with the sender set by the server, only after sharing is announced', () => {
    const { router, a, b } = setupRoom();
    send(router, a.session, { type: 'transcript-segment', text: 'too early' });
    expect(a.sent.at(-1)).toMatchObject({ type: 'error', code: 'invalid-message' });
    expect(b.sent.some((m) => m.type === 'transcript-segment')).toBe(false);

    send(router, a.session, { type: 'transcript-sharing', enabled: true });
    expect(b.sent.at(-1)).toMatchObject({ type: 'transcript-sharing', from: A, enabled: true });
    send(router, a.session, { type: 'transcript-segment', text: 'hello team' });
    expect(b.sent.at(-1)).toMatchObject({ type: 'transcript-segment', from: A, text: 'hello team' });
    expect(a.sent.some((m) => m.type === 'transcript-segment')).toBe(false);
  });

  it('stops relaying after sharing is turned off', () => {
    const { router, a, b } = setupRoom();
    send(router, a.session, { type: 'transcript-sharing', enabled: true });
    send(router, a.session, { type: 'transcript-sharing', enabled: false });
    expect(b.sent.at(-1)).toMatchObject({ type: 'transcript-sharing', enabled: false });
    send(router, a.session, { type: 'transcript-segment', text: 'nope' });
    expect(a.sent.at(-1)).toMatchObject({ type: 'error', code: 'invalid-message' });
  });

  it('tells a newcomer who is already sharing', () => {
    const { router, a } = setupRoom();
    send(router, a.session, { type: 'transcript-sharing', enabled: true });
    const c = makeSession();
    send(router, c.session, join('c'.repeat(17)));
    expect(c.sent.some((m) => m.type === 'transcript-sharing' && m.from === A && m.enabled)).toBe(true);
  });

  it('validates and rate limits lines', () => {
    const { router, a, b } = setupRoom();
    a.session.notesLimiter = new TokenBucket(2, 0.0001);
    send(router, a.session, { type: 'transcript-sharing', enabled: true });
    send(router, a.session, { type: 'transcript-segment', text: 'x'.repeat(1001) } as never);
    expect(a.sent.at(-1)).toMatchObject({ type: 'error', code: 'invalid-message' });
    send(router, a.session, { type: 'transcript-segment', text: 'one' });
    send(router, a.session, { type: 'transcript-segment', text: 'two' });
    send(router, a.session, { type: 'transcript-segment', text: 'three' });
    expect(a.sent.at(-1)).toMatchObject({ type: 'error', code: 'rate-limited' });
    expect(b.sent.filter((m) => m.type === 'transcript-segment')).toHaveLength(2);
  });
});
