export type TranscriptionStatus = 'idle' | 'loading-model' | 'listening' | 'paused' | 'model-unavailable' | 'error';

/** One recognised stretch of speech. Only your own microphone is transcribed, so the speaker is always you. */
export interface TranscriptSegment {
  id: string;
  /** Milliseconds since epoch when the speech started / ended. */
  startedAt: number;
  endedAt: number;
  text: string;
  speaker: 'you';
}

export interface ModelProgress {
  /** 0..1, or null if the size is not known yet. */
  fraction: number | null;
  file?: string;
}

export interface TranscriptionFailure {
  /** Short, user-facing. */
  message: string;
  recovery: string;
}

export interface TranscriptionState {
  status: TranscriptionStatus;
  progress: ModelProgress | null;
  failure: TranscriptionFailure | null;
  /** True while speech is being recognised (the model is working on an utterance). */
  busy: boolean;
  /** Utterances skipped because the device could not keep up. */
  dropped: number;
  /** Final segments for the current meeting, oldest first. */
  segments: TranscriptSegment[];
}

/** What the speech model accepts: mono 16 kHz float samples. */
export const SAMPLE_RATE = 16_000;
