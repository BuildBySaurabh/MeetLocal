import type * as MediaPipeVision from '@mediapipe/tasks-vision';
import { looksInverted, maskFromConfidence, type PersonMask } from './personMask';

export interface PersonSegmenter {
  load(): Promise<void>;
  /** The person mask for this frame, or null if none is available yet. */
  segment(video: HTMLVideoElement, timestampMs: number): PersonMask | null;
  dispose(): void;
}

/** The segmentation model file is not on this device (or could not be started). */
export class SegmenterModelMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SegmenterModelMissingError';
  }
}

export interface SegmenterConfig {
  wasmPath: string;
  modelPath: string;
}

export function getSegmenterConfig(
  env: { VITE_SEGMENTER_MODEL_URL?: string },
  base = import.meta.env.BASE_URL,
): SegmenterConfig {
  return {
    wasmPath: `${base}mediapipe/wasm`,
    modelPath: env.VITE_SEGMENTER_MODEL_URL || `${base}models/selfie_segmenter.tflite`,
  };
}

type Vision = typeof MediaPipeVision;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * MediaPipe selfie segmentation on this device. Created lazily: the library and model are only
 * loaded when the user picks a background effect. Frames stay in memory and are never sent anywhere
 * except as the (already processed) video of the call itself.
 */
export function createMediaPipeSegmenter(
  config: SegmenterConfig,
  loadVision: () => Promise<Vision> = () => import('@mediapipe/tasks-vision'),
  fetchImpl: FetchLike = (i, init) => fetch(i, init),
): PersonSegmenter {
  let segmenter: MediaPipeVision.ImageSegmenter | null = null;
  let lastTimestamp = -1;
  // Decided on the first masks we see: the model's "person" channel/polarity is checked, not assumed.
  let invert: boolean | null = null;

  return {
    async load() {
      let present = false;
      try {
        const head = await fetchImpl(config.modelPath, { method: 'HEAD' });
        present = head.ok && !(head.headers.get('content-type') ?? '').includes('text/html');
      } catch {
        present = false;
      }
      if (!present) throw new SegmenterModelMissingError('The background model file was not found.');

      const vision = await loadVision();
      const fileset = await vision.FilesetResolver.forVisionTasks(config.wasmPath);
      const create = (delegate: 'GPU' | 'CPU') =>
        vision.ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: config.modelPath, delegate },
          runningMode: 'VIDEO',
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        });
      try {
        segmenter = await create('GPU');
      } catch {
        segmenter = await create('CPU');
      }
    },
    segment(video, timestampMs) {
      if (!segmenter) return null;
      lastTimestamp = Math.max(timestampMs, lastTimestamp + 1);
      let out: PersonMask | null = null;
      segmenter.segmentForVideo(video, lastTimestamp, (result) => {
        const masks = result.confidenceMasks;
        if (!masks || masks.length === 0) return;
        // With two channels (background, person) take the second; with one, it is the person.
        const mask = masks.length > 1 ? masks[1]! : masks[0]!;
        const values = mask.getAsFloat32Array();
        if (invert === null) {
          const probe = maskFromConfidence(values, mask.width, mask.height, false);
          invert = looksInverted(probe);
        }
        out = maskFromConfidence(values, mask.width, mask.height, invert);
      });
      return out;
    },
    dispose() {
      segmenter?.close();
      segmenter = null;
    },
  };
}
