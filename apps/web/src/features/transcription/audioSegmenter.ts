import { SAMPLE_RATE } from './transcription.types';

export interface Utterance {
  samples: Float32Array;
  startedAt: number;
  endedAt: number;
}

export interface SegmenterOptions {
  /** RMS level (0..1) above which a frame counts as speech. */
  threshold?: number;
  /** Silence needed after speech before the utterance is closed. */
  silenceMs?: number;
  /** Utterances with less speech than this are dropped (clicks, coughs). */
  minSpeechMs?: number;
  /** Long speech is cut here so the model gets bounded input. */
  maxUtteranceMs?: number;
  /** Audio kept from just before speech was detected, so first syllables are not clipped. */
  prerollMs?: number;
}

const FRAME = SAMPLE_RATE / 50; // 20 ms

/**
 * Splits a continuous 16 kHz microphone signal into utterances using a simple loudness gate.
 * Pure and synchronous: feed it samples and the current time, it returns finished utterances.
 * This is a basic energy gate, not a trained voice detector: steady background noise above the
 * threshold keeps it "speaking" (until the maximum length) and very quiet speech can be missed.
 */
export class AudioSegmenter {
  private readonly threshold: number;
  private readonly silenceFrames: number;
  private readonly minSpeechFrames: number;
  private readonly maxFrames: number;
  private readonly prerollFrames: number;

  private pending = new Float32Array(0);
  private preroll: Float32Array[] = [];
  private frames: Float32Array[] = [];
  private speechFrames = 0;
  private silentRun = 0;
  private speaking = false;
  private startedAt = 0;

  constructor(options: SegmenterOptions = {}) {
    const frameMs = 20;
    this.threshold = options.threshold ?? 0.015;
    this.silenceFrames = Math.ceil((options.silenceMs ?? 800) / frameMs);
    this.minSpeechFrames = Math.ceil((options.minSpeechMs ?? 300) / frameMs);
    this.maxFrames = Math.ceil((options.maxUtteranceMs ?? 20_000) / frameMs);
    this.prerollFrames = Math.ceil((options.prerollMs ?? 200) / frameMs);
  }

  /** `now` is the time at the END of `samples`. */
  push(samples: Float32Array, now: number): Utterance[] {
    const merged = new Float32Array(this.pending.length + samples.length);
    merged.set(this.pending);
    merged.set(samples, this.pending.length);

    const out: Utterance[] = [];
    let offset = 0;
    const totalFrames = Math.floor(merged.length / FRAME);
    for (let i = 0; i < totalFrames; i += 1) {
      const frame = merged.subarray(offset, offset + FRAME);
      offset += FRAME;
      // Time at the end of this frame, counted back from `now`.
      const remainingSamples = merged.length - offset;
      const frameEnd = now - (remainingSamples / SAMPLE_RATE) * 1000;
      const done = this.pushFrame(frame, frameEnd);
      if (done) out.push(done);
    }
    this.pending = merged.slice(offset);
    return out;
  }

  /** Closes any utterance in progress (e.g. when transcription is paused or stopped). */
  flush(now: number): Utterance | null {
    this.pending = new Float32Array(0);
    const done = this.speaking ? this.finish(now) : null;
    this.reset();
    return done;
  }

  private pushFrame(frame: Float32Array, frameEnd: number): Utterance | null {
    const copy = frame.slice();
    const loud = rms(copy) >= this.threshold;
    if (!this.speaking) {
      if (!loud) {
        this.preroll.push(copy);
        if (this.preroll.length > this.prerollFrames) this.preroll.shift();
        return null;
      }
      this.speaking = true;
      this.frames = [...this.preroll, copy];
      this.startedAt = frameEnd - (this.frames.length * FRAME * 1000) / SAMPLE_RATE;
      this.preroll = [];
      this.speechFrames = 1;
      this.silentRun = 0;
      return null;
    }
    this.frames.push(copy);
    if (loud) {
      this.speechFrames += 1;
      this.silentRun = 0;
    } else {
      this.silentRun += 1;
    }
    if (this.silentRun >= this.silenceFrames || this.frames.length >= this.maxFrames) {
      const done = this.finish(frameEnd);
      this.reset();
      return done;
    }
    return null;
  }

  private finish(endedAt: number): Utterance | null {
    if (this.speechFrames < this.minSpeechFrames) return null;
    const samples = new Float32Array(this.frames.length * FRAME);
    this.frames.forEach((f, i) => samples.set(f, i * FRAME));
    return { samples, startedAt: this.startedAt, endedAt };
  }

  private reset(): void {
    this.speaking = false;
    this.frames = [];
    this.preroll = [];
    this.speechFrames = 0;
    this.silentRun = 0;
  }
}

export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length);
}
