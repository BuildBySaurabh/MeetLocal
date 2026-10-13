import type { ModelProgress } from './transcription.types';

export interface TranscriptionEngine {
  /** Downloads (first time only) and prepares the speech model. */
  load(onProgress: (progress: ModelProgress) => void): Promise<void>;
  /** Recognises mono 16 kHz samples. Resolves to plain text ('' if nothing was recognised). */
  transcribe(samples: Float32Array): Promise<string>;
  dispose(): void;
}

/** Thrown by `load` when the model could not be fetched or started. */
export class ModelUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelUnavailableError';
  }
}

export interface WhisperConfig {
  model: string;
  /** Alternative model host (e.g. your own server) instead of huggingface.co. */
  host?: string;
}

export const DEFAULT_MODEL = 'onnx-community/whisper-tiny.en';

export function getWhisperConfig(env: {
  VITE_TRANSCRIPTION_MODEL?: string;
  VITE_TRANSCRIPTION_MODEL_HOST?: string;
}): WhisperConfig {
  return {
    model: env.VITE_TRANSCRIPTION_MODEL || DEFAULT_MODEL,
    host: env.VITE_TRANSCRIPTION_MODEL_HOST || undefined,
  };
}

// Messages between the page and the worker.
export type WorkerRequest =
  { type: 'load'; config: WhisperConfig; wasmPath: string } | { type: 'transcribe'; id: number; samples: Float32Array };
export type WorkerResponse =
  | { type: 'progress'; progress: ModelProgress }
  | { type: 'ready' }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; id?: number; message: string };

export interface WorkerLike {
  postMessage(message: WorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

/**
 * Runs Whisper in a Web Worker (transformers.js + ONNX Runtime WebAssembly) so the page stays
 * responsive. The model files are downloaded by this browser from the configured host the first
 * time and cached by the browser; audio never leaves the device.
 */
export function createWhisperEngine(
  config: WhisperConfig,
  createWorker: () => WorkerLike = () =>
    new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike,
  wasmPath = `${import.meta.env.BASE_URL}ort/`,
): TranscriptionEngine {
  let worker: WorkerLike | null = null;
  let nextId = 1;
  let onProgress: (progress: ModelProgress) => void = () => undefined;
  let loadHandlers: { resolve(): void; reject(error: Error): void } | null = null;
  const pending = new Map<number, { resolve(text: string): void; reject(error: Error): void }>();

  function failAll(error: Error) {
    loadHandlers?.reject(error);
    loadHandlers = null;
    for (const handlers of pending.values()) handlers.reject(error);
    pending.clear();
  }

  function ensureWorker(): WorkerLike {
    if (worker) return worker;
    const w = createWorker();
    w.onmessage = (event) => {
      const message = event.data;
      if (message.type === 'progress') onProgress(message.progress);
      else if (message.type === 'ready') {
        loadHandlers?.resolve();
        loadHandlers = null;
      } else if (message.type === 'result') {
        pending.get(message.id)?.resolve(message.text);
        pending.delete(message.id);
      } else if (message.type === 'error') {
        if (message.id === undefined) {
          loadHandlers?.reject(new ModelUnavailableError(message.message));
          loadHandlers = null;
        } else {
          pending.get(message.id)?.reject(new Error(message.message));
          pending.delete(message.id);
        }
      }
    };
    w.onerror = () => failAll(new ModelUnavailableError('The speech worker could not start.'));
    worker = w;
    return w;
  }

  return {
    load(progress) {
      onProgress = progress;
      const w = ensureWorker();
      return new Promise<void>((resolve, reject) => {
        loadHandlers = { resolve, reject };
        w.postMessage({ type: 'load', config, wasmPath });
      });
    },
    transcribe(samples) {
      const w = ensureWorker();
      const id = nextId++;
      return new Promise<string>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        w.postMessage({ type: 'transcribe', id, samples }, [samples.buffer]);
      });
    },
    dispose() {
      failAll(new Error('Transcription stopped.'));
      worker?.terminate();
      worker = null;
    },
  };
}
