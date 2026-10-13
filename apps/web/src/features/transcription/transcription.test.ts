import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeStream, FakeTrack, asStream, flush } from '../../test/fakes';
import { AudioSegmenter } from './audioSegmenter';
import { downsample, startAudioCapture, type CaptureContext } from './audioCapture';
import {
  ModelUnavailableError,
  createWhisperEngine,
  getWhisperConfig,
  type TranscriptionEngine,
  type WorkerLike,
  type WorkerRequest,
} from './transcriptionEngine';
import { createIndexedDbStore, createMemoryStore, formatTranscript } from './transcriptStore';
import { TranscriptionSession, isNonSpeech } from './transcriptionSession';

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const loud = (ms: number, level = 0.3) => new Float32Array(16 * ms).fill(level);
const quiet = (ms: number) => new Float32Array(16 * ms);

describe('AudioSegmenter', () => {
  it('emits one utterance after speech followed by silence, with timestamps', () => {
    const seg = new AudioSegmenter();
    let t = 10_000;
    const out = [];
    for (const chunk of [quiet(500), loud(1000), quiet(1000)]) {
      t += chunk.length / 16;
      out.push(...seg.push(chunk, t));
    }
    expect(out).toHaveLength(1);
    const u = out[0]!;
    expect(u.samples.length).toBeGreaterThanOrEqual(16 * 1000);
    expect(u.startedAt).toBeGreaterThanOrEqual(10_000 + 500 - 250);
    expect(u.startedAt).toBeLessThanOrEqual(10_000 + 500);
    expect(u.endedAt).toBeGreaterThan(u.startedAt + 1000);
  });

  it('ignores silence and very short blips', () => {
    const seg = new AudioSegmenter();
    expect(seg.push(quiet(3000), 3000)).toEqual([]);
    expect(seg.push(loud(100), 3100)).toEqual([]);
    expect(seg.push(quiet(1000), 4100)).toEqual([]);
  });

  it('cuts very long speech at the maximum length', () => {
    const seg = new AudioSegmenter({ maxUtteranceMs: 2000 });
    const out = seg.push(loud(5000), 5000);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out[0]!.samples.length).toBeLessThanOrEqual(16 * 2000 + 320);
  });

  it('flush returns speech in progress', () => {
    const seg = new AudioSegmenter();
    seg.push(loud(800), 800);
    expect(seg.flush(800)?.samples.length).toBeGreaterThan(0);
    expect(seg.flush(900)).toBeNull();
  });

  it('handles chunk sizes that are not multiples of a frame', () => {
    const seg = new AudioSegmenter();
    let t = 0;
    const out = [];
    for (let i = 0; i < 30; i += 1) {
      t += 100 / 3;
      out.push(...seg.push(loud(33), t));
    }
    out.push(...seg.push(quiet(1000), t + 1000));
    expect(out).toHaveLength(1);
  });
});

describe('downsample', () => {
  it('averages 48 kHz down to 16 kHz', () => {
    const out = downsample(Float32Array.from([1, 1, 1, 0, 0, 0]), 48_000);
    expect(Array.from(out)).toEqual([1, 0]);
  });
  it('passes 16 kHz through and refuses upsampling', () => {
    const input = new Float32Array(4);
    expect(downsample(input, 16_000)).toBe(input);
    expect(() => downsample(input, 8000)).toThrow();
  });
});

describe('startAudioCapture', () => {
  function fakeContext() {
    const closed = vi.fn(async () => undefined);
    const sourceDisconnect = vi.fn();
    const context: CaptureContext = {
      sampleRate: 48_000,
      audioWorklet: { addModule: vi.fn(async () => undefined) },
      createMediaStreamSource: () => ({ connect: vi.fn(), disconnect: sourceDisconnect }),
      resume: async () => undefined,
      close: closed,
    };
    return { context, closed, sourceDisconnect };
  }

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
  });

  it('delivers 16 kHz samples and releases everything on stop', async () => {
    const { context, closed, sourceDisconnect } = fakeContext();
    let push: (s: Float32Array) => void = () => undefined;
    const nodeDisconnect = vi.fn();
    const got: Float32Array[] = [];
    const capture = await startAudioCapture(
      asStream(new FakeStream([new FakeTrack('audio')])),
      (s) => got.push(s),
      () => context,
      (_ctx, onChunk) => {
        push = onChunk;
        return { disconnect: nodeDisconnect };
      },
    );
    push(new Float32Array(480));
    expect(got[0]!.length).toBe(160);
    capture.stop();
    capture.stop();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(sourceDisconnect).toHaveBeenCalledTimes(1);
    expect(nodeDisconnect).toHaveBeenCalledTimes(1);
  });

  it('rejects without an audio track or Web Audio', async () => {
    await expect(
      startAudioCapture(asStream(new FakeStream([new FakeTrack('video')])), () => undefined),
    ).rejects.toThrow('no-audio-track');
    await expect(
      startAudioCapture(
        asStream(new FakeStream([new FakeTrack('audio')])),
        () => undefined,
        () => null,
      ),
    ).rejects.toThrow('unsupported');
  });

  it('closes the context if the worklet cannot load', async () => {
    const { context, closed } = fakeContext();
    context.audioWorklet.addModule = vi.fn(async () => {
      throw new Error('blocked');
    });
    await expect(
      startAudioCapture(
        asStream(new FakeStream([new FakeTrack('audio')])),
        () => undefined,
        () => context,
      ),
    ).rejects.toThrow('blocked');
    expect(closed).toHaveBeenCalled();
  });
});

describe('createWhisperEngine', () => {
  class FakeWorker implements WorkerLike {
    onmessage: WorkerLike['onmessage'] = null;
    onerror: WorkerLike['onerror'] = null;
    sent: WorkerRequest[] = [];
    terminated = false;
    postMessage(message: WorkerRequest) {
      this.sent.push(message);
    }
    terminate() {
      this.terminated = true;
    }
    emit(data: unknown) {
      this.onmessage?.({ data } as MessageEvent);
    }
  }

  it('loads, reports progress, transcribes and terminates the worker', async () => {
    const worker = new FakeWorker();
    const engine = createWhisperEngine({ model: 'm' }, () => worker, '/ort/');
    const progress = vi.fn();
    const loading = engine.load(progress);
    expect(worker.sent[0]).toEqual({ type: 'load', config: { model: 'm' }, wasmPath: '/ort/' });
    worker.emit({ type: 'progress', progress: { fraction: 0.5 } });
    worker.emit({ type: 'ready' });
    await loading;
    expect(progress).toHaveBeenCalledWith({ fraction: 0.5 });

    const result = engine.transcribe(new Float32Array(10));
    const request = worker.sent[1] as Extract<WorkerRequest, { type: 'transcribe' }>;
    worker.emit({ type: 'result', id: request.id, text: 'hello' });
    await expect(result).resolves.toBe('hello');

    engine.dispose();
    expect(worker.terminated).toBe(true);
  });

  it('reports load failure as model-unavailable', async () => {
    const worker = new FakeWorker();
    const engine = createWhisperEngine({ model: 'm' }, () => worker);
    const loading = engine.load(() => undefined);
    worker.emit({ type: 'error', message: 'Failed to fetch' });
    await expect(loading).rejects.toBeInstanceOf(ModelUnavailableError);
  });

  it('rejects pending work when disposed and maps worker crashes', async () => {
    const worker = new FakeWorker();
    const engine = createWhisperEngine({ model: 'm' }, () => worker);
    const pending = engine.transcribe(new Float32Array(1));
    engine.dispose();
    await expect(pending).rejects.toThrow('stopped');

    const crashing = new FakeWorker();
    const engine2 = createWhisperEngine({ model: 'm' }, () => crashing);
    const loading = engine2.load(() => undefined);
    crashing.onerror?.({} as ErrorEvent);
    await expect(loading).rejects.toBeInstanceOf(ModelUnavailableError);
  });

  it('reads model configuration from the environment', () => {
    expect(getWhisperConfig({}).model).toBe('onnx-community/whisper-tiny.en');
    expect(getWhisperConfig({ VITE_TRANSCRIPTION_MODEL: 'x', VITE_TRANSCRIPTION_MODEL_HOST: 'https://h' })).toEqual({
      model: 'x',
      host: 'https://h',
    });
  });
});

describe('transcript stores', () => {
  const seg = (id: string, startedAt: number) => ({
    id,
    startedAt,
    endedAt: startedAt + 1,
    text: id,
    speaker: 'you' as const,
  });

  it.each([
    ['memory', () => createMemoryStore()],
    ['indexeddb', () => createIndexedDbStore()],
  ])('%s store: add, list in time order, clear one meeting, clear all', async (_name, make) => {
    const store = make();
    await store.clearAll();
    await store.add('m1', seg('b', 2));
    await store.add('m1', seg('a', 1));
    await store.add('m2', seg('c', 3));
    expect((await store.list('m1')).map((s) => s.id)).toEqual(['a', 'b']);
    expect(await store.list('m1')).toEqual([seg('a', 1), seg('b', 2)]);
    await store.clearMeeting('m1');
    expect(await store.list('m1')).toEqual([]);
    expect(await store.list('m2')).toHaveLength(1);
    await store.clearAll();
    expect(await store.list('m2')).toEqual([]);
  });

  it('formats an export that says it is automatic', () => {
    const text = formatTranscript([{ id: '1', startedAt: 0, endedAt: 1, text: 'hi there', speaker: 'you' }]);
    expect(text).toContain('You: hi there');
    expect(text).toMatch(/may contain errors/);
  });
});

describe('isNonSpeech', () => {
  it.each(['', '  ', '[BLANK_AUDIO]', '(silence)', '*music*', '...', '…'])('treats %j as non-speech', (t) => {
    expect(isNonSpeech(t)).toBe(true);
  });
  it('keeps real text', () => {
    expect(isNonSpeech('Hello (world)')).toBe(false);
  });
});

describe('TranscriptionSession', () => {
  class FakeEngine implements TranscriptionEngine {
    loaded = false;
    disposed = false;
    texts: string[] = [];
    loadError: Error | null = null;
    release: (() => void) | null = null;
    hold = false;
    async load(onProgress: (p: { fraction: number | null }) => void) {
      onProgress({ fraction: 0.5 });
      if (this.loadError) throw this.loadError;
      this.loaded = true;
    }
    async transcribe() {
      if (this.hold) await new Promise<void>((resolve) => (this.release = resolve));
      return this.texts.shift() ?? '';
    }
    dispose() {
      this.disposed = true;
    }
  }

  function setup(opts: { stream?: FakeStream | null } = {}) {
    const engine = new FakeEngine();
    const store = createMemoryStore();
    let feed: (s: Float32Array) => void = () => undefined;
    const captureStop = vi.fn();
    const startCapture = vi.fn(async (_stream: MediaStream, onSamples: (s: Float32Array) => void) => {
      feed = onSamples;
      return { stop: captureStop };
    });
    let clock = 1_000_000;
    const session = new TranscriptionSession('room1', {
      createEngine: () => engine,
      startCapture,
      store,
      now: () => clock,
      generateId: (() => {
        let n = 0;
        return () => `id${(n += 1)}`;
      })(),
    });
    const stream = opts.stream === undefined ? new FakeStream([new FakeTrack('audio')]) : opts.stream;
    const speak = async (ms = 1000) => {
      clock += ms;
      feed(loud(ms));
      clock += 1000;
      feed(quiet(1000));
      await flush(20);
    };
    return { engine, store, session, startCapture, captureStop, stream: stream && asStream(stream), speak };
  }

  it('does nothing until started, then loads the model and listens', async () => {
    const { engine, session, startCapture, stream } = setup();
    expect(session.getState().status).toBe('idle');
    expect(startCapture).not.toHaveBeenCalled();
    const starting = session.start(stream);
    expect(session.getState().status).toBe('loading-model');
    await starting;
    expect(engine.loaded).toBe(true);
    expect(session.getState().status).toBe('listening');
  });

  it('transcribes speech into timestamped segments and saves them locally', async () => {
    const { engine, session, store, stream, speak } = setup();
    engine.texts = ['hello world'];
    await session.start(stream);
    await speak();
    const segments = session.getState().segments;
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ text: 'hello world', speaker: 'you' });
    expect(segments[0]!.endedAt).toBeGreaterThan(segments[0]!.startedAt);
    expect(await store.list('room1')).toEqual(segments);
  });

  it('drops blank-audio markers', async () => {
    const { engine, session, stream, speak } = setup();
    engine.texts = ['[BLANK_AUDIO]'];
    await session.start(stream);
    await speak();
    expect(session.getState().segments).toEqual([]);
  });

  it('shows a clear model-unavailable status and can retry', async () => {
    const { engine, session, stream } = setup();
    engine.loadError = new ModelUnavailableError('Failed to fetch');
    await session.start(stream);
    expect(session.getState().status).toBe('model-unavailable');
    expect(session.getState().failure?.recovery).toMatch(/download/i);
    expect(engine.disposed).toBe(true);
    engine.loadError = null;
    await session.start(stream);
    expect(session.getState().status).toBe('listening');
  });

  it('reports missing microphone without opening anything', async () => {
    const { session, startCapture } = setup({ stream: null });
    await session.start(null);
    expect(session.getState().status).toBe('error');
    expect(session.getState().failure?.message).toMatch(/no microphone/i);
    expect(startCapture).not.toHaveBeenCalled();
  });

  it('pausing stops the capture and keeps pending speech; resume listens again', async () => {
    const { engine, session, captureStop, startCapture, stream } = setup();
    engine.texts = ['spoken before pause'];
    await session.start(stream);
    session.pause();
    expect(session.getState().status).toBe('paused');
    expect(captureStop).toHaveBeenCalledTimes(1);
    await session.resume();
    expect(session.getState().status).toBe('listening');
    expect(startCapture).toHaveBeenCalledTimes(2);
  });

  it('stop releases capture and the model but keeps saved lines', async () => {
    const { engine, session, captureStop, stream, speak } = setup();
    engine.texts = ['keep me'];
    await session.start(stream);
    await speak();
    session.stop();
    expect(captureStop).toHaveBeenCalled();
    expect(engine.disposed).toBe(true);
    expect(session.getState().status).toBe('idle');
    expect(session.getState().segments).toHaveLength(1);
  });

  it('switches to a new microphone stream while listening', async () => {
    const { session, startCapture, captureStop, stream } = setup();
    await session.start(stream);
    await session.setStream(asStream(new FakeStream([new FakeTrack('audio', 'mic2')])));
    expect(captureStop).toHaveBeenCalledTimes(1);
    expect(startCapture).toHaveBeenCalledTimes(2);
    expect(session.getState().status).toBe('listening');
  });

  it('clears the saved transcript and loads history after a refresh', async () => {
    const { session, store, stream } = setup();
    await store.add('room1', { id: 'old', startedAt: 1, endedAt: 2, text: 'earlier', speaker: 'you' });
    await session.loadHistory();
    expect(session.getState().segments.map((s) => s.text)).toEqual(['earlier']);
    await session.clear();
    expect(session.getState().segments).toEqual([]);
    expect(await store.list('room1')).toEqual([]);
    void stream;
  });

  it('skips the oldest audio when the model cannot keep up and says so', async () => {
    const { engine, session, stream, speak } = setup();
    engine.hold = true;
    await session.start(stream);
    for (let i = 0; i < 6; i += 1) await speak();
    expect(session.getState().dropped).toBeGreaterThan(0);
    engine.hold = false;
    engine.release?.();
    session.dispose();
  });

  it('dispose releases everything and ignores later calls', async () => {
    const { engine, session, stream } = setup();
    await session.start(stream);
    session.dispose();
    expect(engine.disposed).toBe(true);
    await session.start(stream);
    expect(session.getState().status).toBe('idle');
  });
});
