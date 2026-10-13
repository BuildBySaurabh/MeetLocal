import { SAMPLE_RATE } from './transcription.types';

export interface AudioCapture {
  stop(): void;
}

/** Lowers the sample rate by averaging (a basic low-pass) then picking samples. Pure. */
export function downsample(input: Float32Array, fromRate: number, toRate = SAMPLE_RATE): Float32Array {
  if (fromRate === toRate) return input;
  if (fromRate < toRate) throw new Error('Upsampling is not supported');
  const ratio = fromRate / toRate;
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += input[j] ?? 0;
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

/** The slice of Web Audio we use, so tests can substitute a fake. */
export interface CaptureContext {
  sampleRate: number;
  audioWorklet: { addModule(url: string): Promise<void> };
  createMediaStreamSource(stream: MediaStream): { connect(node: unknown): void; disconnect(): void };
  resume(): Promise<void>;
  close(): Promise<void>;
}

export type WorkletNodeFactory = (context: CaptureContext, onChunk: (samples: Float32Array) => void) => AudioNodeLike;
export interface AudioNodeLike {
  disconnect(): void;
}

const WORKLET_SOURCE = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice()); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('meetlocal-tap', Tap);
`;

const defaultNodeFactory: WorkletNodeFactory = (context, onChunk) => {
  const node = new AudioWorkletNode(context as unknown as BaseAudioContext, 'meetlocal-tap', {
    numberOfOutputs: 0,
  });
  node.port.onmessage = (event: MessageEvent<Float32Array>) => onChunk(event.data);
  return node;
};

/**
 * Taps a microphone stream and delivers mono 16 kHz samples. The audio goes nowhere else: it is not
 * played, not recorded and not sent over the network. Throws if the stream has no audio track or
 * Web Audio / AudioWorklet is unavailable.
 */
export async function startAudioCapture(
  stream: MediaStream,
  onSamples: (samples: Float32Array) => void,
  createContext: () => CaptureContext | null = () =>
    typeof AudioContext === 'undefined' ? null : (new AudioContext() as unknown as CaptureContext),
  createNode: WorkletNodeFactory = defaultNodeFactory,
): Promise<AudioCapture> {
  if (stream.getAudioTracks().length === 0) throw new Error('no-audio-track');
  const context = createContext();
  if (!context || !context.audioWorklet) throw new Error('unsupported');

  const blobUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
  try {
    await context.audioWorklet.addModule(blobUrl);
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }

  const source = context.createMediaStreamSource(stream);
  const node = createNode(context, (chunk) => onSamples(downsample(chunk, context.sampleRate)));
  source.connect(node);
  await context.resume().catch(() => undefined);

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      source.disconnect();
      node.disconnect();
      context.close().catch((error: unknown) => console.warn('Could not close audio capture', error));
    },
  };
}
