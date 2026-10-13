import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asStream, flush, makeStream, type FakeStream } from '../../test/fakes';
import { PeerSession, type PeerCallbacks, type PeerState } from './peerConnection';

class FakeSender {
  replaced: unknown[] = [];
  constructor(public track: unknown) {}
  async replaceTrack(track: unknown) {
    this.track = track;
    this.replaced.push(track);
  }
}

class FakePC {
  connectionState: RTCPeerConnectionState = 'new';
  localDescription: { sdp: string } | null = null;
  onicecandidate: ((e: { candidate: unknown }) => void) | null = null;
  ontrack: ((e: { streams: unknown[]; track: unknown }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  tracks: unknown[] = [];
  senders: FakeSender[] = [];
  transceivers: Array<{ kind: string; init: unknown; sender: FakeSender }> = [];
  remoteDescriptions: unknown[] = [];
  addedCandidates: unknown[] = [];
  offerOptions: unknown[] = [];
  closed = false;

  addTrack(track: unknown) {
    const sender = new FakeSender(track);
    this.tracks.push(track);
    this.senders.push(sender);
    return sender;
  }
  addTransceiver(kind: string, init: unknown) {
    const sender = new FakeSender(null);
    this.transceivers.push({ kind, init, sender });
    this.senders.push(sender);
    return { sender };
  }
  async createOffer(options?: unknown) {
    this.offerOptions.push(options);
    return { type: 'offer', sdp: 'offer-sdp' };
  }
  async createAnswer() {
    return { type: 'answer', sdp: 'answer-sdp' };
  }
  async setLocalDescription(d: { sdp: string }) {
    this.localDescription = { sdp: d.sdp };
  }
  async setRemoteDescription(d: unknown) {
    this.remoteDescriptions.push(d);
  }
  async addIceCandidate(c: unknown) {
    this.addedCandidates.push(c);
  }
  close() {
    this.closed = true;
  }
  emitState(state: RTCPeerConnectionState) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

function setup(opts: { isOfferer: boolean; stream?: FakeStream | null }) {
  const pc = new FakePC();
  const states: PeerState[] = [];
  const callbacks = {
    onLocalDescription: vi.fn(),
    onIceCandidate: vi.fn(),
    onRemoteStream: vi.fn(),
    onStateChange: vi.fn((s: PeerState) => void states.push(s)),
  } satisfies PeerCallbacks;
  const localStream = opts.stream === undefined ? makeStream() : opts.stream;
  const session = new PeerSession(
    { iceServers: [], localStream: localStream ? asStream(localStream) : null, isOfferer: opts.isOfferer },
    callbacks,
    () => pc as unknown as RTCPeerConnection,
  );
  return { pc, session, callbacks, states, localStream };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('PeerSession media setup', () => {
  it('sends every local track', () => {
    const { pc, localStream } = setup({ isOfferer: true });
    expect(pc.tracks).toEqual(localStream?.tracks);
    expect(pc.transceivers).toHaveLength(0);
  });

  it('adds track-less send/receive slots for kinds it cannot send, so it can still watch and listen', () => {
    const noMedia = setup({ isOfferer: true, stream: null });
    expect(noMedia.pc.transceivers.map((t) => t.kind)).toEqual(['audio', 'video']);
    expect(noMedia.pc.transceivers[0]?.init).toEqual({ direction: 'sendrecv' });

    const audioOnly = setup({ isOfferer: true, stream: makeStream(['audio']) });
    expect(audioOnly.pc.transceivers.map((t) => t.kind)).toEqual(['video']);
  });
});

describe('PeerSession negotiation', () => {
  it('offerer creates and reports an offer', async () => {
    const { callbacks, pc, session } = setup({ isOfferer: true });
    await session.createOffer();
    expect(pc.localDescription?.sdp).toBe('offer-sdp');
    expect(callbacks.onLocalDescription).toHaveBeenCalledWith({ type: 'offer', sdp: 'offer-sdp' });
  });

  it('answerer applies the offer and reports an answer', async () => {
    const { callbacks, pc, session } = setup({ isOfferer: false });
    await session.handleOffer({ type: 'offer', sdp: 'remote-offer' });
    expect(pc.remoteDescriptions).toEqual([{ type: 'offer', sdp: 'remote-offer' }]);
    expect(callbacks.onLocalDescription).toHaveBeenCalledWith({ type: 'answer', sdp: 'answer-sdp' });
  });

  it('the offerer ignores an unexpected offer', async () => {
    const { callbacks, pc, session } = setup({ isOfferer: true });
    await session.handleOffer({ type: 'offer', sdp: 'x' });
    expect(pc.remoteDescriptions).toHaveLength(0);
    expect(callbacks.onLocalDescription).not.toHaveBeenCalled();
  });

  it('queues ICE candidates that arrive before the remote description, then applies them in order', async () => {
    const { pc, session } = setup({ isOfferer: true });
    await session.createOffer();
    await session.handleIceCandidate({ candidate: 'c1' });
    await session.handleIceCandidate({ candidate: 'c2' });
    expect(pc.addedCandidates).toEqual([]);

    await session.handleAnswer({ type: 'answer', sdp: 'remote-answer' });
    expect(pc.addedCandidates).toEqual([{ candidate: 'c1' }, { candidate: 'c2' }]);

    await session.handleIceCandidate({ candidate: 'c3' });
    expect(pc.addedCandidates).toHaveLength(3);
  });

  it('keeps applying queued candidates when one is rejected', async () => {
    const { pc, session } = setup({ isOfferer: false });
    const original = pc.addIceCandidate.bind(pc);
    pc.addIceCandidate = async (c: unknown) => {
      if ((c as { candidate: string }).candidate === 'bad') throw new Error('bad candidate');
      return original(c);
    };
    await session.handleIceCandidate({ candidate: 'bad' });
    await session.handleIceCandidate({ candidate: 'good' });
    await session.handleOffer({ type: 'offer', sdp: 'o' });
    expect(pc.addedCandidates).toEqual([{ candidate: 'good' }]);
  });

  it('forwards local ICE candidates in protocol shape and ignores end-of-candidates', () => {
    const { pc, callbacks } = setup({ isOfferer: true });
    pc.onicecandidate?.({
      candidate: { candidate: 'cand', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'u', toJSON: () => ({}) },
    });
    pc.onicecandidate?.({ candidate: null });
    expect(callbacks.onIceCandidate).toHaveBeenCalledTimes(1);
    expect(callbacks.onIceCandidate).toHaveBeenCalledWith({
      candidate: 'cand',
      sdpMid: '0',
      sdpMLineIndex: 0,
      usernameFragment: 'u',
    });
  });

  it('reports the remote stream', () => {
    const { pc, callbacks } = setup({ isOfferer: false });
    const remote = makeStream();
    pc.ontrack?.({ streams: [remote], track: remote.tracks[0] });
    expect(callbacks.onRemoteStream).toHaveBeenCalledWith(remote);
  });
});

describe('PeerSession connection state', () => {
  it('maps connection states to UI states, treating a later "connecting" as reconnecting', () => {
    const { pc, states } = setup({ isOfferer: true });
    pc.emitState('connecting');
    pc.emitState('connected');
    pc.emitState('connecting');
    expect(states).toEqual(['connecting', 'connected', 'reconnecting']);
  });

  it('offerer restarts ICE on failure, then gives up after two attempts', async () => {
    const { pc, states, callbacks } = setup({ isOfferer: true });
    for (let i = 0; i < 3; i += 1) {
      pc.emitState('failed');
      await flush();
    }
    expect(pc.offerOptions).toEqual([{ iceRestart: true }, { iceRestart: true }]);
    expect(callbacks.onLocalDescription).toHaveBeenCalledTimes(2);
    expect(states.filter((s) => s === 'reconnecting')).toHaveLength(2);
    expect(states.at(-1)).toBe('failed');
  });

  it('answerer cannot restart, so it reports failure', async () => {
    const { pc, states } = setup({ isOfferer: false });
    pc.emitState('failed');
    await flush();
    expect(states).toEqual(['failed']);
    expect(pc.offerOptions).toHaveLength(0);
  });

  it('offerer restarts ICE if the connection stays disconnected', async () => {
    vi.useFakeTimers();
    const { pc, states } = setup({ isOfferer: true });
    pc.emitState('disconnected');
    expect(states).toEqual(['reconnecting']);
    await vi.advanceTimersByTimeAsync(4100);
    expect(pc.offerOptions).toEqual([{ iceRestart: true }]);
  });

  it('does not restart if the connection recovers during the grace period', async () => {
    vi.useFakeTimers();
    const { pc, states } = setup({ isOfferer: true });
    pc.emitState('disconnected');
    pc.emitState('connected');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pc.offerOptions).toHaveLength(0);
    expect(states.at(-1)).toBe('connected');
  });
});

describe('PeerSession track replacement (no renegotiation)', () => {
  it('swaps the outgoing video track, e.g. camera to screen share and back', async () => {
    const { pc, session, callbacks } = setup({ isOfferer: true });
    const screen = { kind: 'video' } as MediaStreamTrack;
    const camera = pc.tracks[1];

    await session.replaceVideoTrack(screen);
    expect(pc.senders[1]?.track).toBe(screen);
    await session.replaceVideoTrack(camera as MediaStreamTrack);
    expect(pc.senders[1]?.track).toBe(camera);
    expect(pc.offerOptions).toHaveLength(0);
    expect(callbacks.onLocalDescription).not.toHaveBeenCalled();
  });

  it('can start sending video even when there was no camera at join time', async () => {
    const { pc, session } = setup({ isOfferer: true, stream: makeStream(['audio']) });
    const screen = { kind: 'video' } as MediaStreamTrack;
    await session.replaceVideoTrack(screen);
    expect(pc.transceivers[0]?.sender.track).toBe(screen);
  });

  it('swaps or stops the audio track', async () => {
    const { pc, session } = setup({ isOfferer: true });
    const mic = { kind: 'audio' } as MediaStreamTrack;
    await session.replaceAudioTrack(mic);
    expect(pc.senders[0]?.track).toBe(mic);
    await session.replaceAudioTrack(null);
    expect(pc.senders[0]?.track).toBeNull();
  });

  it('does nothing after close', async () => {
    const { pc, session } = setup({ isOfferer: true });
    session.close();
    await session.replaceVideoTrack({ kind: 'video' } as MediaStreamTrack);
    expect(pc.senders.every((s) => s.replaced.length === 0)).toBe(true);
  });
});

describe('PeerSession cleanup', () => {
  it('closes the connection, detaches handlers, ignores later events and leaves local tracks running', async () => {
    vi.useFakeTimers();
    const { pc, session, states, localStream } = setup({ isOfferer: true });
    pc.emitState('disconnected');
    session.close();

    expect(pc.closed).toBe(true);
    expect(pc.onicecandidate).toBeNull();
    expect(pc.ontrack).toBeNull();
    expect(pc.onconnectionstatechange).toBeNull();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(pc.offerOptions).toHaveLength(0); // pending restart timer was cancelled
    expect(states).toEqual(['reconnecting']);
    expect(localStream?.tracks.some((t) => t.stopped)).toBe(false);
    expect(() => session.close()).not.toThrow();

    await session.createOffer(); // no-ops after close
    expect(pc.offerOptions).toHaveLength(0);
  });
});
