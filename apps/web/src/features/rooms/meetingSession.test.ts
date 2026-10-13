import type { ClientMessage, Participant, ServerMessage } from '@meetlocal/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeStream, FakeTrack, asStream, asTrack, flush, makeStream } from '../../test/fakes';
import { makeFailure } from '../media/media.service';
import type { MediaResult, ScreenResult, TrackResult } from '../media/media.types';
import type { SignalingHandlers } from '../signaling/signalingClient';
import type { PeerCallbacks, PeerLike, PeerOptions } from '../webrtc/peerConnection';
import { MeetingSession, type MeetingDeps, type MeetingOptions } from './meetingSession';

const ROOM = 'R'.repeat(22);
const ALICE: Participant = { id: 'alice-alice-alice-1', displayName: 'Alice' };
const BOB: Participant = { id: 'bob-bob-bob-bob-12', displayName: 'Bob' };

class FakeSignaling {
  sent: ClientMessage[] = [];
  connected = false;
  closed = false;
  sendResult = true;
  constructor(public handlers: SignalingHandlers) {}
  connect() {
    this.connected = true;
  }
  send(message: ClientMessage) {
    if (!this.sendResult) return false;
    this.sent.push(message);
    return true;
  }
  close() {
    this.closed = true;
  }
  open() {
    this.handlers.onOpen();
  }
  async receive(message: ServerMessage) {
    this.handlers.onMessage(message);
    await flush();
  }
  drop() {
    this.handlers.onClose({ code: 1006, wasOpen: true });
  }
  ofType<T extends ClientMessage['type']>(type: T) {
    return this.sent.filter((m): m is Extract<ClientMessage, { type: T }> => m.type === type);
  }
}

class FakePeer implements PeerLike {
  calls: string[] = [];
  videoTracks: Array<MediaStreamTrack | null> = [];
  audioTracks: Array<MediaStreamTrack | null> = [];
  closed = false;
  failOffer = false;
  failReplace = false;
  constructor(
    public options: PeerOptions,
    public callbacks: PeerCallbacks,
  ) {}
  async createOffer() {
    this.calls.push('createOffer');
    if (this.failOffer) throw new Error('offer failed');
  }
  async handleOffer() {
    this.calls.push('handleOffer');
  }
  async handleAnswer() {
    this.calls.push('handleAnswer');
  }
  async handleIceCandidate() {
    this.calls.push('handleIceCandidate');
  }
  async replaceVideoTrack(track: MediaStreamTrack | null) {
    if (this.failReplace) throw new Error('replace failed');
    this.videoTracks.push(track);
  }
  async replaceAudioTrack(track: MediaStreamTrack | null) {
    if (this.failReplace) throw new Error('replace failed');
    this.audioTracks.push(track);
  }
  close() {
    this.closed = true;
  }
}

interface SetupOptions {
  media?: () => Promise<MediaResult>;
  intent?: MeetingOptions['intent'];
  failOffer?: boolean;
  screen?: () => Promise<ScreenResult>;
  track?: (kind: 'video' | 'audio', deviceId: string) => Promise<TrackResult>;
}

function setup(opts: SetupOptions = {}) {
  const signalings: FakeSignaling[] = [];
  const peers: FakePeer[] = [];
  const stream = makeStream();
  let idCounter = 0;
  const deps: MeetingDeps = {
    requestMedia: opts.media ?? (async () => ({ ok: true, stream: asStream(stream), missing: [] })),
    requestScreenShare: opts.screen ?? (async () => ({ ok: true, stream: asStream(makeStream(['video'])) })),
    requestTrack:
      opts.track ?? (async (kind, deviceId) => ({ ok: true, track: asTrack(new FakeTrack(kind, deviceId)) })),
    createStream: (tracks) => asStream(new FakeStream(tracks as unknown as FakeTrack[])),
    createSignaling: (handlers) => {
      const s = new FakeSignaling(handlers);
      signalings.push(s);
      return s;
    },
    createPeer: (options, callbacks) => {
      const p = new FakePeer(options, callbacks);
      p.failOffer = opts.failOffer ?? false;
      peers.push(p);
      return p;
    },
    iceServers: [],
    generateParticipantId: () => `participant-id-${(idCounter += 1)}`,
    now: () => 1_000,
    reconnectDelayMs: () => 10,
  };
  const session = new MeetingSession({ roomId: ROOM, displayName: 'Me', intent: opts.intent ?? 'create' }, deps);
  return { session, signalings, peers, stream };
}

type Ctx = ReturnType<typeof setup>;

async function startAndJoin(ctx: Ctx, others: Participant[] = []) {
  await ctx.session.start();
  const sig = ctx.signalings[0]!;
  sig.open();
  await sig.receive({ type: 'joined', roomId: ROOM, selfId: 'participant-id-1', participants: others });
  return sig;
}

/** A started session with Bob present and connected. */
async function inCallWithBob(opts: SetupOptions = {}) {
  const ctx = setup(opts);
  const sig = await startAndJoin(ctx);
  await sig.receive({ type: 'participant-joined', participant: BOB });
  ctx.peers[0]!.callbacks.onStateChange('connected');
  return { ...ctx, sig, peer: ctx.peers[0]! };
}

const asFake = (stream: MediaStream | null) => stream as unknown as FakeStream;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('joining', () => {
  it('opens media, connects, sends a join with a generated id and waits alone', async () => {
    const ctx = setup({ intent: 'create' });
    const sig = await startAndJoin(ctx);

    expect(sig.sent[0]).toEqual({
      type: 'join',
      roomId: ROOM,
      participantId: 'participant-id-1',
      displayName: 'Me',
      intent: 'create',
    });
    const state = ctx.session.getState();
    expect(state.status).toBe('waiting');
    expect(state.hasMic && state.hasCamera && state.micEnabled && state.cameraEnabled).toBe(true);
    expect(state.cameraId).toBe('video-default');
    expect(state.microphoneId).toBe('audio-default');
    expect(ctx.peers).toHaveLength(0);
  });

  it('records when the participant joined, and keeps the original time on rejoin', async () => {
    vi.useFakeTimers();
    const ctx = setup();
    const sig = await startAndJoin(ctx);
    expect(ctx.session.getState().joinedAt).toBe(1_000);

    sig.drop();
    await vi.advanceTimersByTimeAsync(20);
    const second = ctx.signalings[1]!;
    second.open();
    await second.receive({ type: 'joined', roomId: ROOM, selfId: 'participant-id-2', participants: [] });
    expect(ctx.session.getState().joinedAt).toBe(1_000);
  });

  it('starts only once', async () => {
    const ctx = setup();
    await ctx.session.start();
    await ctx.session.start();
    expect(ctx.signalings).toHaveLength(1);
  });

  it('existing participant makes the offer when someone joins', async () => {
    const ctx = setup();
    const sig = await startAndJoin(ctx);
    await sig.receive({ type: 'participant-joined', participant: BOB });

    const peer = ctx.peers[0]!;
    expect(peer.options.isOfferer).toBe(true);
    expect(peer.options.localStream).toBe(asStream(ctx.stream));
    expect(peer.calls).toContain('createOffer');
    expect(ctx.session.getState()).toMatchObject({ status: 'connecting', remoteParticipant: BOB });

    peer.callbacks.onLocalDescription({ type: 'offer', sdp: 'sdp' });
    peer.callbacks.onIceCandidate({ candidate: 'cand', sdpMid: '0', sdpMLineIndex: 0 });
    expect(sig.sent.slice(1)).toEqual([
      { type: 'media-state', micEnabled: true, cameraEnabled: true, screenSharing: false },
      { type: 'offer', to: BOB.id, description: { type: 'offer', sdp: 'sdp' } },
      { type: 'ice-candidate', to: BOB.id, candidate: { candidate: 'cand', sdpMid: '0', sdpMLineIndex: 0 } },
    ]);
  });

  it('newcomer waits for the offer and answers it', async () => {
    const ctx = setup({ intent: 'join' });
    const sig = await startAndJoin(ctx, [ALICE]);

    const peer = ctx.peers[0]!;
    expect(peer.options.isOfferer).toBe(false);
    expect(peer.calls).not.toContain('createOffer');
    expect(ctx.session.getState()).toMatchObject({ status: 'connecting', remoteParticipant: ALICE });

    await sig.receive({ type: 'offer', from: ALICE.id, description: { type: 'offer', sdp: 's' } });
    await sig.receive({ type: 'ice-candidate', from: ALICE.id, candidate: { candidate: 'c' } });
    expect(peer.calls).toEqual(['handleOffer', 'handleIceCandidate']);

    peer.callbacks.onLocalDescription({ type: 'answer', sdp: 'a' });
    expect(sig.sent.at(-1)).toEqual({ type: 'answer', to: ALICE.id, description: { type: 'answer', sdp: 'a' } });
  });

  it('ignores signaling messages from someone other than the current peer', async () => {
    const ctx = setup({ intent: 'join' });
    const sig = await startAndJoin(ctx, [ALICE]);
    await sig.receive({ type: 'offer', from: BOB.id, description: { type: 'offer', sdp: 's' } });
    expect(ctx.peers[0]!.calls).toEqual([]);
  });
});

describe('connection lifecycle', () => {
  it('reports connected and exposes the remote stream', async () => {
    const { session, peer } = await inCallWithBob();
    const remote = makeStream();
    peer.callbacks.onRemoteStream(asStream(remote));
    expect(session.getState()).toMatchObject({
      status: 'connected',
      remoteStream: asStream(remote),
      remoteHasVideo: true,
    });
  });

  it('reflects reconnecting and returns to connected', async () => {
    const { session, peer } = await inCallWithBob();
    peer.callbacks.onStateChange('reconnecting');
    expect(session.getState().status).toBe('reconnecting');
    peer.callbacks.onStateChange('connected');
    expect(session.getState().status).toBe('connected');
  });

  it('goes back to waiting and closes the peer when the other participant leaves', async () => {
    const { session, peer, sig } = await inCallWithBob();
    await sig.receive({ type: 'participant-left', participantId: BOB.id });
    expect(peer.closed).toBe(true);
    expect(session.getState()).toMatchObject({
      status: 'waiting',
      remoteParticipant: null,
      remoteStream: null,
      remoteMediaState: null,
    });
  });

  it('builds a fresh peer when the other participant rejoins', async () => {
    const ctx = setup();
    const sig = await startAndJoin(ctx);
    await sig.receive({ type: 'participant-joined', participant: BOB });
    await sig.receive({ type: 'participant-left', participantId: BOB.id });
    await sig.receive({ type: 'participant-joined', participant: BOB });
    expect(ctx.peers).toHaveLength(2);
    expect(ctx.peers[0]!.closed).toBe(true);
    expect(ctx.peers[1]!.closed).toBe(false);
  });

  it('explains ICE failure and stops', async () => {
    const { session, peer, sig } = await inCallWithBob();
    peer.callbacks.onStateChange('failed');
    const state = session.getState();
    expect(state.status).toBe('failed');
    expect(state.error?.code).toBe('ice-failed');
    expect(state.error?.message).toMatch(/TURN/);
    expect(peer.closed).toBe(true);
    expect(sig.closed).toBe(true);
  });

  it('fails clearly when negotiation throws', async () => {
    const ctx = setup({ failOffer: true });
    const sig = await startAndJoin(ctx);
    await sig.receive({ type: 'participant-joined', participant: BOB });
    expect(ctx.session.getState()).toMatchObject({ status: 'failed', error: { code: 'negotiation-failed' } });
  });

  it('ignores callbacks from a peer that has been replaced', async () => {
    const ctx = setup();
    const sig = await startAndJoin(ctx);
    await sig.receive({ type: 'participant-joined', participant: BOB });
    const stale = ctx.peers[0]!;
    await sig.receive({ type: 'participant-left', participantId: BOB.id });
    stale.callbacks.onStateChange('failed');
    expect(ctx.session.getState().status).toBe('waiting');
  });
});

describe('server errors', () => {
  it.each([
    ['room-not-found', 'Meeting not found'],
    ['room-full', 'This meeting is full'],
    ['duplicate-participant', 'Already connected'],
  ] as const)('shows a recoverable error for %s', async (code, title) => {
    const ctx = setup({ intent: 'join' });
    await ctx.session.start();
    const sig = ctx.signalings[0]!;
    sig.open();
    await sig.receive({ type: 'error', code, message: 'server text' });

    const state = ctx.session.getState();
    expect(state.status).toBe('failed');
    expect(state.error).toMatchObject({ code, title });
    expect(state.error?.recovery.length).toBeGreaterThan(0);
    expect(sig.closed).toBe(true);
  });

  it('does not interrupt the call for a recipient that just left', async () => {
    const ctx = setup();
    const sig = await startAndJoin(ctx);
    await sig.receive({ type: 'error', code: 'unknown-recipient', message: 'gone' });
    expect(ctx.session.getState().status).toBe('waiting');
  });

  it('shows a notice instead of ending the call when a message is rate limited', async () => {
    const { session, sig } = await inCallWithBob();
    await sig.receive({ type: 'error', code: 'rate-limited', message: 'slow' });
    expect(session.getState().status).toBe('connected');
    expect(session.getState().notice).toMatchObject({ kind: 'error', text: expect.stringMatching(/too fast/i) });
  });
});

describe('signaling reconnection', () => {
  it('rejoins with a fresh participant id after the connection drops', async () => {
    vi.useFakeTimers();
    const ctx = setup();
    const sig = await startAndJoin(ctx);
    await sig.receive({ type: 'participant-joined', participant: BOB });
    const peer = ctx.peers[0]!;

    sig.drop();
    expect(peer.closed).toBe(true);
    expect(ctx.session.getState()).toMatchObject({ status: 'reconnecting', remoteParticipant: null });

    await vi.advanceTimersByTimeAsync(20);
    expect(ctx.signalings).toHaveLength(2);
    const second = ctx.signalings[1]!;
    second.open();
    expect(second.sent[0]).toMatchObject({ type: 'join', participantId: 'participant-id-2' });
    await second.receive({ type: 'joined', roomId: ROOM, selfId: 'participant-id-2', participants: [] });
    expect(ctx.session.getState().status).toBe('waiting');
  });

  it('gives up after repeated failures with a clear error', async () => {
    vi.useFakeTimers();
    const ctx = setup();
    await ctx.session.start();
    for (let i = 0; i < 4; i += 1) {
      ctx.signalings.at(-1)!.drop();
      await vi.advanceTimersByTimeAsync(20);
    }
    const state = ctx.session.getState();
    expect(state.status).toBe('failed');
    expect(state.error?.code).toBe('signaling-unavailable');
    expect(ctx.signalings).toHaveLength(4); // initial + 3 retries
  });
});

describe('media handling', () => {
  it('continues without camera or microphone when permission is denied and says why', async () => {
    const ctx = setup({ media: async () => ({ ok: false, failure: makeFailure('permission-denied') }) });
    const sig = await startAndJoin(ctx);
    expect(ctx.session.getState()).toMatchObject({
      localStream: null,
      hasMic: false,
      hasCamera: false,
      mediaFailure: { kind: 'permission-denied' },
    });
    await sig.receive({ type: 'participant-joined', participant: BOB });
    expect(ctx.peers[0]!.options.localStream).toBeNull();
    expect(sig.ofType('media-state')[0]).toEqual({
      type: 'media-state',
      micEnabled: false,
      cameraEnabled: false,
      screenSharing: false,
    });
  });

  it('notes a missing camera when only the microphone is available', async () => {
    const audio = makeStream(['audio']);
    const ctx = setup({ media: async () => ({ ok: true, stream: asStream(audio), missing: ['camera'] }) });
    await ctx.session.start();
    const state = ctx.session.getState();
    expect(state).toMatchObject({ hasMic: true, hasCamera: false, cameraEnabled: false });
    expect(state.mediaNotice).toMatch(/no camera/i);
  });

  it('toggles microphone and camera tracks and tells the other participant', async () => {
    const { session, stream, sig } = await inCallWithBob();
    session.toggleMic();
    session.toggleCamera();
    expect(stream.getAudioTracks()[0]!.enabled).toBe(false);
    expect(stream.getVideoTracks()[0]!.enabled).toBe(false);
    expect(session.getState()).toMatchObject({ micEnabled: false, cameraEnabled: false });
    expect(sig.ofType('media-state').at(-1)).toEqual({
      type: 'media-state',
      micEnabled: false,
      cameraEnabled: false,
      screenSharing: false,
    });
    session.toggleMic();
    expect(stream.getAudioTracks()[0]!.enabled).toBe(true);
    expect(session.getState().micEnabled).toBe(true);
  });

  it('ignores toggles when the device does not exist', async () => {
    const audio = makeStream(['audio']);
    const ctx = setup({ media: async () => ({ ok: true, stream: asStream(audio), missing: ['camera'] }) });
    await ctx.session.start();
    ctx.session.toggleCamera();
    expect(ctx.session.getState().cameraEnabled).toBe(false);
  });
});

describe('remote media state', () => {
  it('records what the other participant reports and ignores strangers', async () => {
    const { session, sig } = await inCallWithBob();
    await sig.receive({
      type: 'media-state',
      from: BOB.id,
      micEnabled: false,
      cameraEnabled: false,
      screenSharing: false,
    });
    expect(session.getState().remoteMediaState).toEqual({
      micEnabled: false,
      cameraEnabled: false,
      screenSharing: false,
    });

    await sig.receive({
      type: 'media-state',
      from: 'someone-else-12345',
      micEnabled: true,
      cameraEnabled: true,
      screenSharing: true,
    });
    expect(session.getState().remoteMediaState?.screenSharing).toBe(false);
  });

  it('announces its own state to a new peer', async () => {
    const ctx = setup({ intent: 'join' });
    const sig = await startAndJoin(ctx, [ALICE]);
    expect(sig.ofType('media-state')).toEqual([
      { type: 'media-state', micEnabled: true, cameraEnabled: true, screenSharing: false },
    ]);
  });
});

describe('chat', () => {
  it('sends a message and shows it as your own', async () => {
    const { session, sig } = await inCallWithBob();
    expect(session.sendChat('  hello Bob  ')).toBe(true);
    expect(sig.ofType('chat')).toEqual([{ type: 'chat', text: 'hello Bob' }]);
    expect(session.getState().chat).toEqual([
      expect.objectContaining({ text: 'hello Bob', own: true, fromName: 'Me', sentAt: 1_000 }),
    ]);
  });

  it('shows received messages with the sender name, keeping markup as plain text', async () => {
    const { session, sig } = await inCallWithBob();
    await sig.receive({ type: 'chat', from: BOB.id, text: '<img src=x onerror=alert(1)>', sentAt: 5 });
    expect(session.getState().chat).toEqual([
      expect.objectContaining({ fromName: 'Bob', text: '<img src=x onerror=alert(1)>', own: false, sentAt: 5 }),
    ]);
  });

  it('does not send empty or oversized messages', async () => {
    const { session, sig } = await inCallWithBob();
    expect(session.sendChat('   ')).toBe(false);
    expect(session.sendChat('x'.repeat(2001))).toBe(false);
    expect(sig.ofType('chat')).toHaveLength(0);
    expect(session.getState().notice?.text).toMatch(/2000/);
  });

  it('is unavailable until someone else has joined', async () => {
    const ctx = setup();
    const sig = await startAndJoin(ctx);
    expect(ctx.session.sendChat('anyone?')).toBe(false);
    expect(sig.ofType('chat')).toHaveLength(0);
    expect(ctx.session.getState().notice).toMatchObject({ kind: 'info' });
  });

  it('reports a message that could not be sent instead of pretending it was', async () => {
    const { session, sig } = await inCallWithBob();
    sig.sendResult = false;
    expect(session.sendChat('hello')).toBe(false);
    expect(session.getState().chat).toHaveLength(0);
    expect(session.getState().notice).toMatchObject({ kind: 'error', text: expect.stringMatching(/not sent/i) });
  });

  it('keeps only the most recent 500 messages and discards history on leave', async () => {
    const { session, sig } = await inCallWithBob();
    for (let i = 0; i < 510; i += 1) await sig.receive({ type: 'chat', from: BOB.id, text: `m${i}`, sentAt: i });
    const chat = session.getState().chat;
    expect(chat).toHaveLength(500);
    expect(chat.at(-1)?.text).toBe('m509');

    session.leave();
    expect(session.getState().chat).toEqual([]);
  });

  it('dismisses notices', async () => {
    const { session } = await inCallWithBob();
    session.sendChat('x'.repeat(2001));
    expect(session.getState().notice).not.toBeNull();
    session.dismissNotice();
    expect(session.getState().notice).toBeNull();
  });
});

describe('screen sharing', () => {
  it('sends the screen instead of the camera and tells the other participant', async () => {
    const screen = makeStream(['video']);
    const { session, peer, sig } = await inCallWithBob({
      screen: async () => ({ ok: true, stream: asStream(screen) }),
    });
    await session.startScreenShare();

    expect(peer.videoTracks.at(-1)).toBe(screen.tracks[0]);
    expect(session.getState()).toMatchObject({ screenSharing: true, screenStream: asStream(screen) });
    expect(sig.ofType('media-state').at(-1)).toMatchObject({ screenSharing: true });
  });

  it('restores the camera when sharing stops', async () => {
    const screen = makeStream(['video']);
    const { session, peer, stream, sig } = await inCallWithBob({
      screen: async () => ({ ok: true, stream: asStream(screen) }),
    });
    await session.startScreenShare();
    await session.stopScreenShare();

    expect(peer.videoTracks.at(-1)).toBe(stream.getVideoTracks()[0]);
    expect(screen.tracks[0]!.stopped).toBe(true);
    expect(session.getState()).toMatchObject({ screenSharing: false, screenStream: null });
    expect(sig.ofType('media-state').at(-1)).toMatchObject({ screenSharing: false });
  });

  it("stops when the user clicks the browser's own Stop sharing button", async () => {
    const screen = makeStream(['video']);
    const { session, peer, stream } = await inCallWithBob({
      screen: async () => ({ ok: true, stream: asStream(screen) }),
    });
    await session.startScreenShare();
    screen.tracks[0]!.end();
    await flush();
    expect(session.getState().screenSharing).toBe(false);
    expect(peer.videoTracks.at(-1)).toBe(stream.getVideoTracks()[0]);
  });

  it('treats a cancelled picker as a normal choice, not an error', async () => {
    const { session, peer } = await inCallWithBob({
      screen: async () => ({ ok: false, cancelled: true, message: 'Screen sharing was cancelled.' }),
    });
    await session.startScreenShare();
    expect(session.getState()).toMatchObject({ screenSharing: false, notice: { kind: 'info' } });
    expect(peer.videoTracks).toHaveLength(0);
  });

  it('explains when screen sharing is unsupported', async () => {
    const { session } = await inCallWithBob({
      screen: async () => ({
        ok: false,
        cancelled: false,
        message: 'Screen sharing is not supported in this browser.',
      }),
    });
    await session.startScreenShare();
    expect(session.getState().notice).toMatchObject({ kind: 'error', text: expect.stringMatching(/not supported/) });
  });

  it('releases the capture if it cannot be sent', async () => {
    const screen = makeStream(['video']);
    const ctx = await inCallWithBob({ screen: async () => ({ ok: true, stream: asStream(screen) }) });
    ctx.peer.failReplace = true;
    await ctx.session.startScreenShare();
    expect(screen.tracks[0]!.stopped).toBe(true);
    expect(ctx.session.getState()).toMatchObject({ screenSharing: false, notice: { kind: 'error' } });
  });

  it('does not start twice', async () => {
    const screen = vi.fn(async () => ({ ok: true as const, stream: asStream(makeStream(['video'])) }));
    const { session } = await inCallWithBob({ screen });
    await session.startScreenShare();
    await session.startScreenShare();
    expect(screen).toHaveBeenCalledTimes(1);
  });

  it('sends the screen to a participant who joins while sharing', async () => {
    const screen = makeStream(['video']);
    const ctx = setup({ screen: async () => ({ ok: true, stream: asStream(screen) }) });
    const sig = await startAndJoin(ctx);
    await ctx.session.startScreenShare(); // alone: nothing to replace yet
    await sig.receive({ type: 'participant-joined', participant: BOB });
    await flush();
    expect(ctx.peers[0]!.videoTracks).toEqual([screen.tracks[0]]);
    expect(sig.ofType('media-state').at(-1)).toMatchObject({ screenSharing: true });
  });

  it('stops the capture when leaving', async () => {
    const screen = makeStream(['video']);
    const { session } = await inCallWithBob({ screen: async () => ({ ok: true, stream: asStream(screen) }) });
    await session.startScreenShare();
    session.leave();
    expect(screen.tracks[0]!.stopped).toBe(true);
    expect(session.getState().screenSharing).toBe(false);
  });
});

describe('switching devices', () => {
  it('switches camera: swaps the outgoing track, stops the old one and updates the selection', async () => {
    const requestTrack = vi.fn(async (kind: 'video' | 'audio', deviceId: string) => ({
      ok: true as const,
      track: asTrack(new FakeTrack(kind, deviceId)),
    }));
    const { session, peer, stream } = await inCallWithBob({ track: requestTrack });
    const oldCamera = stream.getVideoTracks()[0]!;

    await session.selectCamera('cam-2');
    expect(requestTrack).toHaveBeenCalledWith('video', 'cam-2');
    const state = session.getState();
    expect(state.cameraId).toBe('cam-2');
    expect(peer.videoTracks.at(-1)).toBe(asFake(state.localStream).getVideoTracks()[0]);
    expect(oldCamera.stopped).toBe(true);
    expect(state.localStream).not.toBe(asStream(stream)); // new stream so the preview re-attaches
    expect(asFake(state.localStream).getAudioTracks()).toHaveLength(1); // microphone kept
  });

  it('keeps the camera-off choice when switching camera', async () => {
    const { session } = await inCallWithBob();
    session.toggleCamera();
    await session.selectCamera('cam-2');
    expect(session.getState().cameraEnabled).toBe(false);
    expect(asFake(session.getState().localStream).getVideoTracks()[0]!.enabled).toBe(false);
  });

  it('switches microphone and keeps the muted state', async () => {
    const { session, peer } = await inCallWithBob();
    session.toggleMic();
    await session.selectMicrophone('mic-2');
    const state = session.getState();
    expect(state.microphoneId).toBe('mic-2');
    expect(state.micEnabled).toBe(false);
    expect(peer.audioTracks.at(-1)).toBe(asFake(state.localStream).getAudioTracks()[0]);
  });

  it('adds a camera that was not available at join time', async () => {
    const audio = makeStream(['audio']);
    const { session, peer } = await inCallWithBob({
      media: async () => ({ ok: true, stream: asStream(audio), missing: ['camera'] }),
    });
    expect(session.getState().hasCamera).toBe(false);
    await session.selectCamera('new-cam');
    expect(session.getState()).toMatchObject({ hasCamera: true, cameraEnabled: true, cameraId: 'new-cam' });
    expect(peer.videoTracks).toHaveLength(1);
  });

  it('keeps the current device and explains when the new one cannot be opened', async () => {
    const { session, stream } = await inCallWithBob({
      track: async () => ({ ok: false, failure: makeFailure('device-in-use') }),
    });
    const before = session.getState().localStream;
    await session.selectCamera('busy-cam');
    expect(session.getState().localStream).toBe(before);
    expect(stream.getVideoTracks()[0]!.stopped).toBe(false);
    expect(session.getState().notice).toMatchObject({
      kind: 'error',
      text: expect.stringMatching(/another application/),
    });
  });

  it('keeps the old device and stops the new track if the call cannot switch', async () => {
    const created: FakeTrack[] = [];
    const ctx = await inCallWithBob({
      track: async (kind, id) => {
        const t = new FakeTrack(kind, id);
        created.push(t);
        return { ok: true, track: asTrack(t) };
      },
    });
    ctx.peer.failReplace = true;
    await ctx.session.selectCamera('cam-2');
    expect(created[0]!.stopped).toBe(true);
    expect(ctx.stream.getVideoTracks()[0]!.stopped).toBe(false);
    expect(ctx.session.getState().cameraId).toBe('video-default');
  });

  it('does not replace the outgoing video while a screen is being shared', async () => {
    const { session, peer } = await inCallWithBob();
    await session.startScreenShare();
    const before = peer.videoTracks.length;
    await session.selectCamera('cam-2');
    expect(peer.videoTracks).toHaveLength(before);
    expect(session.getState().cameraId).toBe('cam-2');
  });

  it('releases a newly opened device if the user left meanwhile', async () => {
    let resolve!: (r: TrackResult) => void;
    const ctx = setup({ track: () => new Promise<TrackResult>((r) => (resolve = r)) });
    await ctx.session.start();
    const switching = ctx.session.selectCamera('cam-2');
    ctx.session.leave();
    const late = new FakeTrack('video', 'cam-2');
    resolve({ ok: true, track: asTrack(late) });
    await switching;
    expect(late.stopped).toBe(true);
  });
});

describe('devices disappearing', () => {
  it('handles the camera being unplugged', async () => {
    const { session, peer, stream, sig } = await inCallWithBob();
    stream.getVideoTracks()[0]!.end();
    await flush();
    expect(session.getState()).toMatchObject({ hasCamera: false, cameraEnabled: false, cameraId: null });
    expect(session.getState().notice).toMatchObject({
      kind: 'error',
      text: expect.stringMatching(/camera was disconnected/),
    });
    expect(peer.videoTracks.at(-1)).toBeNull();
    expect(sig.ofType('media-state').at(-1)).toMatchObject({ cameraEnabled: false });
  });

  it('handles the microphone being unplugged', async () => {
    const { session, peer, stream } = await inCallWithBob();
    stream.getAudioTracks()[0]!.end();
    await flush();
    expect(session.getState()).toMatchObject({ hasMic: false, micEnabled: false, microphoneId: null });
    expect(peer.audioTracks.at(-1)).toBeNull();
  });

  it('does not react to a track we replaced ourselves', async () => {
    const { session, stream } = await inCallWithBob();
    const old = stream.getVideoTracks()[0]!;
    await session.selectCamera('cam-2');
    old.end();
    await flush();
    expect(session.getState().hasCamera).toBe(true);
    expect(session.getState().notice).toBeNull();
  });
});

describe('leaving and cleanup', () => {
  it('sends leave, closes signaling and the peer, and stops local tracks', async () => {
    const ctx = setup();
    const sig = await startAndJoin(ctx);
    await sig.receive({ type: 'participant-joined', participant: BOB });

    ctx.session.leave();
    expect(sig.sent.at(-1)).toEqual({ type: 'leave' });
    expect(sig.closed).toBe(true);
    expect(ctx.peers[0]!.closed).toBe(true);
    expect(ctx.stream.tracks.every((t) => t.stopped)).toBe(true);
    expect(ctx.session.getState()).toMatchObject({ status: 'ended', localStream: null });
  });

  it('is idempotent and ignores later server messages', async () => {
    const ctx = setup();
    const sig = await startAndJoin(ctx);
    ctx.session.leave();
    expect(() => ctx.session.leave()).not.toThrow();
    await sig.receive({ type: 'participant-joined', participant: BOB });
    expect(ctx.peers).toHaveLength(0);
    expect(ctx.session.getState().status).toBe('ended');
  });

  it('releases devices if the user leaves while the permission prompt is open', async () => {
    let resolveMedia!: (value: MediaResult) => void;
    const stream: FakeStream = makeStream();
    const ctx = setup({ media: () => new Promise<MediaResult>((r) => (resolveMedia = r)) });
    const starting = ctx.session.start();
    ctx.session.leave();
    resolveMedia({ ok: true, stream: asStream(stream), missing: [] });
    await starting;
    expect(stream.tracks.every((t) => t.stopped)).toBe(true);
    expect(ctx.signalings).toHaveLength(0);
  });

  it('does not reconnect after leaving', async () => {
    vi.useFakeTimers();
    const ctx = setup();
    const sig = await startAndJoin(ctx);
    sig.drop();
    ctx.session.leave();
    await vi.advanceTimersByTimeAsync(100);
    expect(ctx.signalings).toHaveLength(1);
  });
});

describe('group calls', () => {
  const CAROL: Participant = { id: 'carol-carol-carol-3', displayName: 'Carol' };
  const DAVE: Participant = { id: 'dave-dave-dave-d-4', displayName: 'Dave' };

  it('as a newcomer, creates one answering peer per existing participant', async () => {
    const ctx = setup({ intent: 'join' });
    await startAndJoin(ctx, [ALICE, BOB]);
    expect(ctx.peers).toHaveLength(2);
    expect(ctx.peers.map((p) => p.options.isOfferer)).toEqual([false, false]);
    expect(ctx.session.getState().remotes.map((r) => r.participant.id)).toEqual([ALICE.id, BOB.id]);
    expect(ctx.session.getState().status).toBe('connecting');
  });

  it('as an existing participant, offers to every newcomer', async () => {
    const ctx = setup();
    const sig = await startAndJoin(ctx);
    await sig.receive({ type: 'participant-joined', participant: BOB });
    await sig.receive({ type: 'participant-joined', participant: CAROL });
    expect(ctx.peers.map((p) => p.calls)).toEqual([['createOffer'], ['createOffer']]);
    expect(ctx.peers.map((p) => p.options.isOfferer)).toEqual([true, true]);
  });

  it('routes offers, answers and ICE candidates to the right peer only', async () => {
    const ctx = setup({ intent: 'join' });
    const sig = await startAndJoin(ctx, [ALICE, BOB]);
    await sig.receive({ type: 'offer', from: BOB.id, description: { type: 'offer', sdp: 'x' } });
    await sig.receive({
      type: 'ice-candidate',
      from: ALICE.id,
      candidate: { candidate: 'candidate:1 1 udp 1 1.1.1.1 1 typ host' },
    });
    expect(ctx.peers[0]!.calls).toEqual(['handleIceCandidate']);
    expect(ctx.peers[1]!.calls).toEqual(['handleOffer']);
  });

  it('keeps media state, streams and names per participant', async () => {
    const ctx = setup();
    const sig = await startAndJoin(ctx);
    await sig.receive({ type: 'participant-joined', participant: BOB });
    await sig.receive({ type: 'participant-joined', participant: CAROL });
    await sig.receive({ type: 'media-state', from: CAROL.id, micEnabled: false, cameraEnabled: true, screenSharing: false });
    const [bob, carol] = ctx.session.getState().remotes;
    expect(bob!.mediaState).toBeNull();
    expect(carol!.mediaState).toEqual({ micEnabled: false, cameraEnabled: true, screenSharing: false });
    const remoteStream = asStream(makeStream());
    ctx.peers[1]!.callbacks.onRemoteStream(remoteStream);
    expect(ctx.session.getState().remotes[1]!.stream).toBe(remoteStream);
    expect(ctx.session.getState().remotes[0]!.stream).toBeNull();
  });

  it('stays connected when one participant leaves and removes only that peer', async () => {
    const ctx = setup();
    const sig = await startAndJoin(ctx);
    await sig.receive({ type: 'participant-joined', participant: BOB });
    await sig.receive({ type: 'participant-joined', participant: CAROL });
    ctx.peers[0]!.callbacks.onStateChange('connected');
    ctx.peers[1]!.callbacks.onStateChange('connected');
    await sig.receive({ type: 'participant-left', participantId: BOB.id });
    expect(ctx.peers[0]!.closed).toBe(true);
    expect(ctx.peers[1]!.closed).toBe(false);
    expect(ctx.session.getState().remotes.map((r) => r.participant.id)).toEqual([CAROL.id]);
    expect(ctx.session.getState().status).toBe('connected');
    await sig.receive({ type: 'participant-left', participantId: CAROL.id });
    expect(ctx.session.getState().status).toBe('waiting');
  });

  it('a failed peer does not end the call while another peer is alive', async () => {
    const ctx = setup();
    const sig = await startAndJoin(ctx);
    await sig.receive({ type: 'participant-joined', participant: BOB });
    await sig.receive({ type: 'participant-joined', participant: CAROL });
    ctx.peers[0]!.callbacks.onStateChange('connected');
    ctx.peers[1]!.callbacks.onStateChange('failed');
    const state = ctx.session.getState();
    expect(state.status).toBe('connected');
    expect(state.notice?.text).toContain('Carol');
    ctx.peers[0]!.callbacks.onStateChange('failed');
    expect(ctx.session.getState().status).toBe('failed');
    expect(ctx.session.getState().error?.code).toBe('ice-failed');
  });

  it('sends screen share, mic and camera changes to every peer', async () => {
    const ctx = setup();
    const sig = await startAndJoin(ctx);
    await sig.receive({ type: 'participant-joined', participant: BOB });
    await sig.receive({ type: 'participant-joined', participant: CAROL });
    await ctx.session.startScreenShare();
    expect(ctx.peers.map((p) => p.videoTracks.length)).toEqual([1, 1]);
    await ctx.session.stopScreenShare();
    expect(ctx.peers.map((p) => p.videoTracks.length)).toEqual([2, 2]);
    await ctx.session.selectMicrophone('mic-2');
    expect(ctx.peers.map((p) => p.audioTracks.length)).toEqual([1, 1]);
  });

  it('sends the current screen share to a participant who joins later', async () => {
    const ctx = setup();
    const sig = await startAndJoin(ctx);
    await sig.receive({ type: 'participant-joined', participant: BOB });
    await ctx.session.startScreenShare();
    await sig.receive({ type: 'participant-joined', participant: DAVE });
    expect(ctx.peers[1]!.videoTracks).toHaveLength(1);
  });

  it('chat shows the sender name, even after they left, and closes every peer on leave', async () => {
    const ctx = setup();
    const sig = await startAndJoin(ctx);
    await sig.receive({ type: 'participant-joined', participant: BOB });
    await sig.receive({ type: 'participant-joined', participant: CAROL });
    await sig.receive({ type: 'chat', from: BOB.id, text: 'hi', sentAt: 5 });
    await sig.receive({ type: 'participant-left', participantId: BOB.id });
    await sig.receive({ type: 'chat', from: BOB.id, text: 'bye', sentAt: 6 });
    expect(ctx.session.getState().chat.map((m) => m.fromName)).toEqual(['Bob', 'Bob']);
    ctx.session.leave();
    expect(ctx.peers.every((p) => p.closed)).toBe(true);
    expect(ctx.session.getState().remotes).toEqual([]);
  });

  it('closes all peers when signaling drops and rebuilds them after rejoining', async () => {
    const ctx = setup();
    const sig = await startAndJoin(ctx);
    await sig.receive({ type: 'participant-joined', participant: BOB });
    await sig.receive({ type: 'participant-joined', participant: CAROL });
    sig.drop();
    expect(ctx.peers.every((p) => p.closed)).toBe(true);
    expect(ctx.session.getState().remotes).toEqual([]);
    expect(ctx.session.getState().status).toBe('reconnecting');
  });
});

describe('shared meeting notes', () => {
  it('sends your own lines only after sharing is switched on, and always keeps them in your notes', async () => {
    const ctx = setup();
    const sig = await startAndJoin(ctx);
    ctx.session.recordOwnSpeech('private line');
    expect(sig.ofType('transcript-segment')).toHaveLength(0);
    expect(ctx.session.getState().notes.map((n) => [n.text, n.own, n.speakerName])).toEqual([['private line', true, 'Me']]);

    ctx.session.setTranscriptSharing(true);
    expect(sig.ofType('transcript-sharing').at(-1)).toMatchObject({ enabled: true });
    ctx.session.recordOwnSpeech('  shared line  ');
    expect(sig.ofType('transcript-segment')).toEqual([{ type: 'transcript-segment', text: 'shared line' }]);

    ctx.session.setTranscriptSharing(false);
    ctx.session.recordOwnSpeech('private again');
    expect(sig.ofType('transcript-segment')).toHaveLength(1);
    expect(ctx.session.getState().notes).toHaveLength(3);
  });

  it('adds other people\'s lines with their names, and tracks who is sharing', async () => {
    const ctx = setup();
    const sig = await startAndJoin(ctx);
    await sig.receive({ type: 'participant-joined', participant: BOB });
    await sig.receive({ type: 'transcript-sharing', from: BOB.id, enabled: true });
    expect(ctx.session.getState().transcriptSharers).toEqual([BOB.id]);
    await sig.receive({ type: 'transcript-segment', from: BOB.id, text: 'hi from Bob', sentAt: 50 });
    expect(ctx.session.getState().notes).toEqual([
      { id: 'note-1', speakerId: BOB.id, speakerName: 'Bob', text: 'hi from Bob', at: 50, own: false },
    ]);
    await sig.receive({ type: 'participant-left', participantId: BOB.id });
    expect(ctx.session.getState().transcriptSharers).toEqual([]);
    expect(ctx.session.getState().notes).toHaveLength(1);
  });

  it('re-announces sharing after reconnecting, and clears everything on leave', async () => {
    const ctx = setup();
    const sig = await startAndJoin(ctx);
    ctx.session.setTranscriptSharing(true);
    sig.drop();
    await new Promise((r) => setTimeout(r, 30));
    const sig2 = ctx.signalings[1]!;
    sig2.open();
    await sig2.receive({ type: 'joined', roomId: ROOM, selfId: 'participant-id-2', participants: [] });
    expect(sig2.ofType('transcript-sharing')).toEqual([{ type: 'transcript-sharing', enabled: true }]);
    ctx.session.recordOwnSpeech('x');
    ctx.session.leave();
    expect(ctx.session.getState()).toMatchObject({ notes: [], sharingTranscript: false, transcriptSharers: [] });
  });

  it('does not claim sharing when the server connection is gone', async () => {
    const ctx = setup();
    const sig = await startAndJoin(ctx);
    sig.sendResult = false;
    ctx.session.setTranscriptSharing(true);
    expect(ctx.session.getState().sharingTranscript).toBe(false);
    expect(ctx.session.getState().notice?.kind).toBe('error');
  });
});

describe('background effect', () => {
  class FakeProcessor {
    started: MediaStreamTrack[] = [];
    modes: unknown[] = [];
    sources: MediaStreamTrack[] = [];
    stopped = false;
    output = asTrack(new FakeTrack('video', 'effect'));
    onEvent: (e: { type: 'ready' } | { type: 'unavailable'; message: string }) => void = () => {};
    start(source: MediaStreamTrack, mode: unknown, onEvent: FakeProcessor['onEvent']) {
      this.started.push(source);
      this.modes.push(mode);
      this.onEvent = onEvent;
      return this.output;
    }
    setMode(mode: unknown) {
      this.modes.push(mode);
    }
    setSource(track: MediaStreamTrack) {
      this.sources.push(track);
    }
    stop() {
      this.stopped = true;
    }
  }

  function withProcessor() {
    const processor = new FakeProcessor();
    const ctx = setup();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ctx.session as any).deps.createBackgroundProcessor = () => processor;
    return { ...ctx, processor };
  }
  const BLUR = { kind: 'blur', strength: 'strong' } as const;

  it('sends the processed track to every peer and shows it in the local tile', async () => {
    const ctx = withProcessor();
    const sig = await startAndJoin(ctx);
    await sig.receive({ type: 'participant-joined', participant: BOB });
    await sig.receive({ type: 'participant-joined', participant: CAROL_ID });
    ctx.session.setBackground(BLUR);
    await flush();
    expect(ctx.processor.started).toHaveLength(1);
    expect(ctx.peers.map((p) => p.videoTracks.at(-1))).toEqual([ctx.processor.output, ctx.processor.output]);
    expect(ctx.session.getState().background).toEqual(BLUR);
    expect(ctx.session.getState().backgroundStatus.kind).toBe('loading');
    expect(ctx.session.getState().effectStream).not.toBeNull();
    ctx.processor.onEvent({ type: 'ready' });
    expect(ctx.session.getState().backgroundStatus.kind).toBe('on');
  });

  it('changes mode without restarting, and restores the camera when turned off', async () => {
    const ctx = withProcessor();
    const sig = await startAndJoin(ctx);
    await sig.receive({ type: 'participant-joined', participant: BOB });
    ctx.session.setBackground(BLUR);
    ctx.session.setBackground({ kind: 'minimal', preset: 'sage' });
    expect(ctx.processor.started).toHaveLength(1);
    expect(ctx.processor.modes.at(-1)).toEqual({ kind: 'minimal', preset: 'sage' });
    ctx.session.setBackground({ kind: 'none' });
    await flush();
    const camera = ctx.session.getState().localStream!.getVideoTracks()[0];
    expect(ctx.processor.stopped).toBe(true);
    expect(ctx.peers[0]!.videoTracks.at(-1)).toBe(camera);
    expect(ctx.session.getState()).toMatchObject({ background: { kind: 'none' }, effectStream: null });
  });

  it('falls back to the camera and explains when the model is missing', async () => {
    const ctx = withProcessor();
    const sig = await startAndJoin(ctx);
    await sig.receive({ type: 'participant-joined', participant: BOB });
    ctx.session.setBackground(BLUR);
    ctx.processor.onEvent({ type: 'unavailable', message: 'model missing, run fetch' });
    await flush();
    const state = ctx.session.getState();
    expect(state.background.kind).toBe('none');
    expect(state.backgroundStatus).toEqual({ kind: 'unavailable', message: 'model missing, run fetch' });
    expect(state.notice?.text).toBe('model missing, run fetch');
    expect(ctx.peers[0]!.videoTracks.at(-1)).toBe(state.localStream!.getVideoTracks()[0]);
  });

  it('keeps the effect when switching camera, and gives a new peer the effect track', async () => {
    const ctx = withProcessor();
    const sig = await startAndJoin(ctx);
    await sig.receive({ type: 'participant-joined', participant: BOB });
    ctx.session.setBackground(BLUR);
    await ctx.session.selectCamera('cam-2');
    expect(ctx.processor.sources).toHaveLength(1);
    expect(ctx.peers[0]!.videoTracks.at(-1)).toBe(ctx.processor.output);
    await sig.receive({ type: 'participant-joined', participant: CAROL_ID });
    expect(ctx.peers[1]!.videoTracks.at(-1)).toBe(ctx.processor.output);
  });

  it('screen share wins while it lasts, then the effect returns', async () => {
    const ctx = withProcessor();
    const sig = await startAndJoin(ctx);
    await sig.receive({ type: 'participant-joined', participant: BOB });
    ctx.session.setBackground(BLUR);
    await flush();
    await ctx.session.startScreenShare();
    const screen = ctx.peers[0]!.videoTracks.at(-1);
    expect(screen).not.toBe(ctx.processor.output);
    await ctx.session.stopScreenShare();
    expect(ctx.peers[0]!.videoTracks.at(-1)).toBe(ctx.processor.output);
  });

  it('needs a camera, and leaving stops the processor', async () => {
    const noCam = setup({ media: async () => ({ ok: true, stream: asStream(makeStream(['audio'])), missing: ['camera'] }) });
    await startAndJoin(noCam);
    noCam.session.setBackground(BLUR);
    expect(noCam.session.getState().notice?.text).toBe('Turn on a camera first.');

    const ctx = withProcessor();
    await startAndJoin(ctx);
    ctx.session.setBackground(BLUR);
    ctx.session.leave();
    expect(ctx.processor.stopped).toBe(true);
  });
});
const CAROL_ID: Participant = { id: 'carol-carol-carol-3', displayName: 'Carol' };
