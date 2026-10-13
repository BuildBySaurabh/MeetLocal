import { AudioSegmenter, type Utterance } from './audioSegmenter';
import type { AudioCapture } from './audioCapture';
import { ModelUnavailableError, type TranscriptionEngine } from './transcriptionEngine';
import type { TranscriptStore } from './transcriptStore';
import type { ModelProgress, TranscriptSegment, TranscriptionFailure, TranscriptionState } from './transcription.types';

export interface TranscriptionDeps {
  createEngine(): TranscriptionEngine;
  startCapture(stream: MediaStream, onSamples: (samples: Float32Array) => void): Promise<AudioCapture>;
  store: TranscriptStore;
  now?: () => number;
  generateId?: () => string;
  createSegmenter?: () => AudioSegmenter;
}

type Listener = (state: TranscriptionState) => void;

const MAX_QUEUE = 3;

/** Speech models sometimes emit these for silence or noise. They are not speech. */
export function isNonSpeech(text: string): boolean {
  const t = text.trim();
  if (t === '') return true;
  return /^[[(*].*[\])*]$/.test(t) || /^[.\s…-]+$/.test(t);
}

const FAILURES = {
  modelUnavailable: {
    message: 'The local speech model could not be loaded.',
    recovery:
      'The first use downloads the model into this browser, so it needs a connection to the model host. Check your connection and try again, or set VITE_TRANSCRIPTION_MODEL_HOST to a server you control.',
  },
  noMic: {
    message: 'There is no microphone to transcribe.',
    recovery: 'Allow microphone access for this meeting and start transcription again.',
  },
  capture: {
    message: 'Could not listen to the microphone for transcription.',
    recovery: 'Your browser may not support audio processing here. Try a current Chrome, Edge or Firefox.',
  },
} satisfies Record<string, TranscriptionFailure>;

/**
 * Local-only transcription of your own microphone. Opt-in (nothing happens until `start`), runs the
 * model in a worker, keeps results in the local store and never contacts MeetLocal's servers.
 * Framework-free so it can be tested without React or a real model.
 */
export class TranscriptionSession {
  private state: TranscriptionState = {
    status: 'idle',
    progress: null,
    failure: null,
    busy: false,
    segments: [],
    dropped: 0,
  };
  private readonly listeners = new Set<Listener>();
  private engine: TranscriptionEngine | null = null;
  private capture: AudioCapture | null = null;
  private segmenter: AudioSegmenter | null = null;
  private stream: MediaStream | null = null;
  private queue: Utterance[] = [];
  private working = false;
  private generation = 0;
  private disposed = false;
  private readonly now: () => number;
  private readonly generateId: () => string;

  constructor(
    private readonly meetingId: string,
    private readonly deps: TranscriptionDeps,
  ) {
    this.now = deps.now ?? Date.now;
    this.generateId = deps.generateId ?? (() => `${this.now()}-${Math.random().toString(36).slice(2, 8)}`);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  getState(): TranscriptionState {
    return this.state;
  }

  /** Loads transcripts saved earlier for this meeting (e.g. after a page refresh). */
  async loadHistory(): Promise<void> {
    try {
      const segments = await this.deps.store.list(this.meetingId);
      if (!this.disposed) this.update({ segments });
    } catch (error) {
      console.warn('Could not read saved transcript', error);
    }
  }

  async start(stream: MediaStream | null): Promise<void> {
    if (
      this.disposed ||
      (this.state.status !== 'idle' && this.state.status !== 'model-unavailable' && this.state.status !== 'error')
    )
      return;
    const generation = ++this.generation;
    this.stream = stream;
    this.update({ status: 'loading-model', failure: null, progress: { fraction: null }, dropped: 0 });

    this.engine ??= this.deps.createEngine();
    try {
      await this.engine.load((progress: ModelProgress) => {
        if (generation === this.generation) this.update({ progress });
      });
    } catch (error) {
      if (generation !== this.generation) return;
      console.warn('Speech model failed to load', error);
      this.engine.dispose();
      this.engine = null;
      this.update(
        error instanceof ModelUnavailableError
          ? { status: 'model-unavailable', failure: FAILURES.modelUnavailable, progress: null }
          : { status: 'error', failure: FAILURES.modelUnavailable, progress: null },
      );
      return;
    }
    if (generation !== this.generation) return;
    await this.listen();
  }

  pause(): void {
    if (this.state.status !== 'listening') return;
    this.stopCapture(true);
    this.update({ status: 'paused' });
  }

  async resume(): Promise<void> {
    if (this.state.status !== 'paused') return;
    await this.listen();
  }

  /** Stops listening and releases the model. Saved transcript lines are kept. */
  stop(): void {
    this.generation += 1;
    this.stopCapture(false);
    this.queue = [];
    this.engine?.dispose();
    this.engine = null;
    this.update({ status: 'idle', progress: null, failure: null, busy: false });
  }

  /** Switches to a new microphone stream (e.g. after choosing another device). */
  async setStream(stream: MediaStream | null): Promise<void> {
    this.stream = stream;
    if (this.state.status !== 'listening') return;
    this.stopCapture(true);
    await this.listen();
  }

  async clear(): Promise<void> {
    try {
      await this.deps.store.clearMeeting(this.meetingId);
    } catch (error) {
      console.warn('Could not clear transcript', error);
    }
    this.update({ segments: [] });
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.listeners.clear();
  }

  private async listen(): Promise<void> {
    const generation = this.generation;
    if (!this.stream || this.stream.getAudioTracks().length === 0) {
      this.engine?.dispose();
      this.engine = null;
      this.update({ status: 'error', failure: FAILURES.noMic, progress: null });
      return;
    }
    this.segmenter = this.deps.createSegmenter?.() ?? new AudioSegmenter();
    try {
      const capture = await this.deps.startCapture(this.stream, (samples) => this.onSamples(samples));
      if (generation !== this.generation || this.disposed) {
        capture.stop();
        return;
      }
      this.capture = capture;
      this.update({ status: 'listening', progress: null, failure: null });
    } catch (error) {
      console.warn('Audio capture failed', error);
      if (generation !== this.generation) return;
      this.engine?.dispose();
      this.engine = null;
      this.update({ status: 'error', failure: FAILURES.capture, progress: null });
    }
  }

  private stopCapture(flush: boolean): void {
    this.capture?.stop();
    this.capture = null;
    if (flush && this.segmenter) {
      const last = this.segmenter.flush(this.now());
      if (last) this.enqueue(last);
    }
    this.segmenter = null;
  }

  private onSamples(samples: Float32Array): void {
    if (!this.segmenter) return;
    for (const utterance of this.segmenter.push(samples, this.now())) this.enqueue(utterance);
  }

  private enqueue(utterance: Utterance): void {
    this.queue.push(utterance);
    // If the device cannot keep up, drop the oldest audio rather than fall further behind.
    let dropped = 0;
    while (this.queue.length > MAX_QUEUE) {
      this.queue.shift();
      dropped += 1;
    }
    if (dropped) this.update({ dropped: this.state.dropped + dropped });
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.working) return;
    this.working = true;
    this.update({ busy: true });
    try {
      while (this.queue.length > 0 && this.engine) {
        const utterance = this.queue.shift() as Utterance;
        const engine = this.engine;
        try {
          const text = (await engine.transcribe(utterance.samples)).trim();
          if (this.disposed || isNonSpeech(text)) continue;
          const segment: TranscriptSegment = {
            id: this.generateId(),
            startedAt: utterance.startedAt,
            endedAt: utterance.endedAt,
            text,
            speaker: 'you',
          };
          this.update({ segments: [...this.state.segments, segment] });
          await this.deps.store.add(this.meetingId, segment).catch((error: unknown) => {
            console.warn('Could not save transcript line', error);
          });
        } catch (error) {
          // A stopped engine rejects pending work; anything else is a single failed utterance.
          if (this.engine === engine) console.warn('Transcription of one utterance failed', error);
        }
      }
    } finally {
      this.working = false;
      if (!this.disposed) this.update({ busy: false });
    }
  }

  private update(patch: Partial<TranscriptionState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }
}
