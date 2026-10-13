import type * as MediaPipeVision from '@mediapipe/tasks-vision';
import type { Landmark } from './gaze.types';

export interface FaceLandmarkEngine {
  load(): Promise<void>;
  /** Landmarks of the first face in this frame, or null if no face is visible. */
  detect(video: HTMLVideoElement, timestampMs: number): Landmark[] | null;
  dispose(): void;
}

/** The face model file is not on this device (or could not be started). */
export class FaceModelMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FaceModelMissingError';
  }
}

export interface FaceModelConfig {
  /** Folder with MediaPipe's WebAssembly files (copied from node_modules by scripts/copy-mediapipe.mjs). */
  wasmPath: string;
  /** The `face_landmarker.task` model file, served from this origin by default. */
  modelPath: string;
}

export function getFaceModelConfig(
  env: { VITE_FACE_MODEL_URL?: string },
  base = import.meta.env.BASE_URL,
): FaceModelConfig {
  return {
    wasmPath: `${base}mediapipe/wasm`,
    modelPath: env.VITE_FACE_MODEL_URL || `${base}models/face_landmarker.task`,
  };
}

type Vision = typeof MediaPipeVision;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * MediaPipe Face Landmarker running on this device (WebAssembly, GPU if available). Created lazily: the
 * library is only downloaded when the user turns the camera check on. Frames are processed in memory and
 * never stored or sent anywhere.
 */
export function createMediaPipeEngine(
  config: FaceModelConfig,
  loadVision: () => Promise<Vision> = () => import('@mediapipe/tasks-vision'),
  fetchImpl: FetchLike = (i, init) => fetch(i, init),
): FaceLandmarkEngine {
  let landmarker: MediaPipeVision.FaceLandmarker | null = null;
  let lastTimestamp = -1;

  return {
    async load() {
      // A dev server answers unknown paths with the app's HTML page, so check the content type too.
      let present = false;
      try {
        const head = await fetchImpl(config.modelPath, { method: 'HEAD' });
        present = head.ok && !(head.headers.get('content-type') ?? '').includes('text/html');
      } catch {
        present = false;
      }
      if (!present) throw new FaceModelMissingError('The face model file was not found.');

      const vision = await loadVision();
      const fileset = await vision.FilesetResolver.forVisionTasks(config.wasmPath);
      const create = (delegate: 'GPU' | 'CPU') =>
        vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: config.modelPath, delegate },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
        });
      try {
        landmarker = await create('GPU');
      } catch {
        landmarker = await create('CPU');
      }
    },
    detect(video, timestampMs) {
      if (!landmarker) return null;
      // MediaPipe requires strictly increasing timestamps.
      lastTimestamp = Math.max(timestampMs, lastTimestamp + 1);
      const result = landmarker.detectForVideo(video, lastTimestamp);
      return result.faceLandmarks[0] ?? null;
    },
    dispose() {
      landmarker?.close();
      landmarker = null;
    },
  };
}
