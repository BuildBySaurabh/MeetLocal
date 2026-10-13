import type { FaceLandmarkEngine } from './faceLandmarker';
import { FaceModelMissingError } from './faceLandmarker';
import type { Baseline, CameraCheckState } from './gaze.types';
import { estimate, measure, smooth } from './gazeEstimator';

export interface FrameSource {
  video: HTMLVideoElement;
  dispose(): void;
}

export interface CameraCheckDeps {
  createEngine(): FaceLandmarkEngine;
  /** Plays the camera stream in a hidden element so frames can be analysed. */
  createFrameSource(stream: MediaStream): Promise<FrameSource>;
  now?: () => number;
  /** Replaceable for tests. */
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

type Listener = (state: CameraCheckState) => void;

/** About 4 analyses per second keeps CPU use modest. */
export const INTERVAL_MS = 250;
const MAX_CONSECUTIVE_ERRORS = 5;

const FAILURES = {
  modelMissing: {
    message: 'The face model file is not installed.',
    recovery:
      'Run "npm run fetch:face-model" once (it downloads a ~4 MB file into apps/web/public/models), or set VITE_FACE_MODEL_URL to a copy you host. See docs/LOCAL_AI.md.',
  },
  noCamera: {
    message: 'There is no camera to analyse.',
    recovery: 'Allow camera access for this meeting and turn the camera check on again.',
  },
  failed: {
    message: 'The camera check stopped working.',
    recovery:
      'Turn it off and on again. If it keeps failing, your browser may not support WebAssembly or video analysis.',
  },
} as const;

/**
 * Optional, local, approximate camera/face feedback shown only to the user. Nothing is recorded, stored
 * or sent: frames are analysed in memory and only the latest numbers are kept. Framework-free.
 */
export class CameraCheckSession {
  private state: CameraCheckState = {
    status: 'idle',
    failure: null,
    facePresent: false,
    metrics: null,
    calibrated: false,
  };
  private readonly listeners = new Set<Listener>();
  private engine: FaceLandmarkEngine | null = null;
  private source: FrameSource | null = null;
  private timer: unknown = null;
  private generation = 0;
  private cameraEnabled = true;
  private baseline: Baseline | null = null;
  private errors = 0;
  private disposed = false;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;

  constructor(private readonly deps: CameraCheckDeps) {
    this.now = deps.now ?? (() => performance.now());
    this.schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel = deps.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  getState(): CameraCheckState {
    return this.state;
  }

  async start(stream: MediaStream | null, cameraEnabled: boolean): Promise<void> {
    const busy =
      this.state.status === 'loading-model' || this.state.status === 'running' || this.state.status === 'camera-off';
    if (this.disposed || busy) return;
    this.cameraEnabled = cameraEnabled;
    const generation = ++this.generation;
    if (!stream || stream.getVideoTracks().length === 0) {
      this.update({ status: 'error', failure: FAILURES.noCamera });
      return;
    }
    this.update({ status: 'loading-model', failure: null, facePresent: false, metrics: null });
    const engine = this.deps.createEngine();
    this.engine = engine;
    try {
      await engine.load();
      if (generation !== this.generation) return engine.dispose();
      this.source = await this.deps.createFrameSource(stream);
    } catch (error) {
      if (generation !== this.generation) return;
      console.warn('Camera check could not start', error);
      this.releaseResources();
      this.update({
        status: error instanceof FaceModelMissingError ? 'model-missing' : 'error',
        failure: error instanceof FaceModelMissingError ? FAILURES.modelMissing : FAILURES.failed,
      });
      return;
    }
    if (generation !== this.generation) {
      this.releaseResources();
      return;
    }
    this.errors = 0;
    this.update({ status: this.cameraEnabled ? 'running' : 'camera-off' });
    this.queue(generation);
  }

  /** Tells the session whether the camera is currently switched on, so a black frame is not read as "no face". */
  setCameraEnabled(enabled: boolean): void {
    this.cameraEnabled = enabled;
    if (this.state.status === 'running' && !enabled) this.update({ status: 'camera-off', metrics: null });
    else if (this.state.status === 'camera-off' && enabled) this.update({ status: 'running' });
  }

  /** Records the current head and eye pose as "looking at the camera" so later numbers are relative to it. */
  calibrate(): boolean {
    const raw = this.lastRaw;
    if (!raw || raw.eyeX === null || raw.eyeY === null) return false;
    this.baseline = { pitch: raw.pitchRatio, eyeX: raw.eyeX, eyeY: raw.eyeY };
    this.update({ calibrated: true });
    return true;
  }

  stop(): void {
    this.generation += 1;
    this.releaseResources();
    this.baseline = null;
    this.update({ status: 'idle', failure: null, facePresent: false, metrics: null, calibrated: false });
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.listeners.clear();
  }

  private lastRaw: ReturnType<typeof measure> = null;

  private queue(generation: number): void {
    this.timer = this.schedule(() => this.tick(generation), INTERVAL_MS);
  }

  private tick(generation: number): void {
    if (generation !== this.generation || !this.engine || !this.source) return;
    if (this.state.status === 'running') {
      try {
        const points = this.engine.detect(this.source.video, this.now());
        this.errors = 0;
        const metrics = points ? estimate(points, this.baseline) : null;
        this.lastRaw = points ? measure(points) : null;
        if (metrics) this.update({ metrics: smooth(this.state.metrics, metrics), facePresent: true });
        else if (this.state.metrics) this.update({ metrics: null });
      } catch (error) {
        this.errors += 1;
        console.warn('Camera check frame failed', error);
        if (this.errors >= MAX_CONSECUTIVE_ERRORS) {
          this.releaseResources();
          this.update({ status: 'error', failure: FAILURES.failed, metrics: null });
          return;
        }
      }
    }
    this.queue(generation);
  }

  private releaseResources(): void {
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
    this.engine?.dispose();
    this.engine = null;
    this.source?.dispose();
    this.source = null;
    this.lastRaw = null;
  }

  private update(patch: Partial<CameraCheckState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }
}

/** Plays a stream in an off-screen video element. The stream's tracks are not stopped on dispose: they belong to the call. */
export async function createVideoFrameSource(stream: MediaStream): Promise<FrameSource> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream(stream.getVideoTracks());
  await video.play();
  return {
    video,
    dispose() {
      video.pause();
      video.srcObject = null;
    },
  };
}
