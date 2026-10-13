import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeStream, FakeTrack, asStream } from '../../test/fakes';
import {
  FaceModelMissingError,
  createMediaPipeEngine,
  getFaceModelConfig,
  type FaceLandmarkEngine,
} from './faceLandmarker';
import { CameraCheckSession, INTERVAL_MS, type FrameSource } from './eyeTrackingSession';
import type { Landmark } from './gaze.types';
import { cameraSuggestions, estimate, eyeDirection, headDirection, smooth } from './gazeEstimator';

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

/** A synthetic, camera-facing face in the unmirrored image. Only the landmarks the estimator reads are placed. */
function face(overrides: Record<number, Partial<Landmark>> = {}): Landmark[] {
  const points: Landmark[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  const set: Record<number, Landmark> = {
    234: { x: 0.35, y: 0.5 },
    454: { x: 0.65, y: 0.5 },
    1: { x: 0.5, y: 0.58 },
    168: { x: 0.5, y: 0.4 },
    152: { x: 0.5, y: 0.7 },
    33: { x: 0.4, y: 0.42 },
    133: { x: 0.46, y: 0.42 },
    362: { x: 0.54, y: 0.42 },
    263: { x: 0.6, y: 0.42 },
    468: { x: 0.43, y: 0.42 },
    473: { x: 0.57, y: 0.42 },
    159: { x: 0.43, y: 0.4 },
    145: { x: 0.43, y: 0.44 },
    386: { x: 0.57, y: 0.4 },
    374: { x: 0.57, y: 0.44 },
  };
  for (const [i, p] of Object.entries(set)) points[Number(i)] = p;
  for (const [i, p] of Object.entries(overrides)) points[Number(i)] = { ...points[Number(i)]!, ...p };
  return points;
}

describe('estimate', () => {
  it('reads a camera-facing face as centred and level', () => {
    const m = estimate(face())!;
    expect(Math.abs(m.yaw)).toBeLessThan(1);
    expect(Math.abs(m.pitch)).toBeLessThan(3);
    expect(Math.abs(m.roll)).toBeLessThan(1);
    expect(Math.abs(m.eyeX!)).toBeLessThan(0.05);
    expect(Math.abs(m.eyeY!)).toBeLessThan(0.05);
    expect(m.centerX).toBeCloseTo(0.5);
    expect(m.size).toBeCloseTo(0.3);
    expect(m.outsideFrame).toBe(false);
    expect(headDirection(m)).toBe('facing');
    expect(eyeDirection(m)).toBe('center');
  });

  it('reports turning toward the person’s right when the nose moves toward image-left', () => {
    const m = estimate(face({ 1: { x: 0.42 } }))!;
    expect(m.yaw).toBeGreaterThan(25);
    expect(headDirection(m)).toBe('turned-right');
    expect(headDirection(estimate(face({ 1: { x: 0.58 } }))!)).toBe('turned-left');
  });

  it('reports eyes toward the person’s right when both irises move toward image-left', () => {
    const m = estimate(face({ 468: { x: 0.41 }, 473: { x: 0.55 } }))!;
    expect(m.eyeX).toBeGreaterThan(0.5);
    expect(eyeDirection(m)).toBe('right');
    expect(eyeDirection(estimate(face({ 468: { x: 0.45 }, 473: { x: 0.59 } }))!)).toBe('left');
  });

  it('reads vertical eye direction and treats a blink as unknown', () => {
    expect(eyeDirection(estimate(face({ 468: { y: 0.405 }, 473: { y: 0.405 } }))!)).toBe('up');
    expect(eyeDirection(estimate(face({ 468: { y: 0.435 }, 473: { y: 0.435 } }))!)).toBe('down');
    const blink = estimate(face({ 145: { y: 0.405 }, 374: { y: 0.405 } }))!;
    expect(blink.eyeY).toBeNull();
    expect(eyeDirection(blink)).toBe('unknown');
  });

  it('measures roll from the eye line', () => {
    const m = estimate(face({ 362: { y: 0.44 } }))!;
    expect(m.roll).toBeGreaterThan(10);
  });

  it('detects a face reaching the edge of the frame', () => {
    expect(estimate(face({ 454: { x: 0.995 } }))!.outsideFrame).toBe(true);
  });

  it('subtracts a calibrated baseline', () => {
    const tilted = face({ 1: { y: 0.62 } });
    const uncal = estimate(tilted)!;
    const cal = estimate(tilted, { pitch: (0.62 - 0.4) / 0.3, eyeX: 0, eyeY: 0 })!;
    expect(Math.abs(uncal.pitch)).toBeGreaterThan(Math.abs(cal.pitch));
    expect(Math.abs(cal.pitch)).toBeLessThan(1);
  });

  it('returns null for unusable input', () => {
    expect(estimate([])).toBeNull();
    expect(estimate(face({ 152: { y: 0.3 } }))).toBeNull();
    expect(estimate(face({ 234: { x: 0.7 } }))).toBeNull();
  });
});

describe('cameraSuggestions and smoothing', () => {
  it('suggests framing fixes only', () => {
    expect(cameraSuggestions(null)).toEqual([]);
    const small = estimate(
      face({ 152: { y: 0.5 }, 168: { y: 0.45 }, 1: { y: 0.47 }, 234: { x: 0.45 }, 454: { x: 0.55 } }),
    )!;
    expect(small.size).toBeLessThan(0.25);
    const tips = cameraSuggestions({ ...small, centerX: 0.2, outsideFrame: true, roll: 20, yaw: 30 }).join(' ');
    expect(tips).toMatch(/outside the camera frame/);
    expect(tips).toMatch(/small/);
    expect(tips).toMatch(/middle/);
    expect(tips).toMatch(/tilted sideways/);
    expect(tips).toMatch(/from the side/);
    expect(tips).not.toMatch(/attention|honest|cheat|distract|focus/i);
  });

  it('smooths toward new values and handles nulls', () => {
    const a = estimate(face())!;
    const b = { ...a, yaw: 20, eyeX: null };
    const s = smooth(a, b, 0.5);
    expect(s.yaw).toBeCloseTo(10, 0);
    expect(s.eyeX).toBeNull();
    expect(smooth(null, b)).toBe(b);
  });
});

describe('CameraCheckSession', () => {
  class FakeEngine implements FaceLandmarkEngine {
    points: Landmark[] | null = face();
    loadError: Error | null = null;
    detectError: Error | null = null;
    disposed = false;
    detects = 0;
    async load() {
      if (this.loadError) throw this.loadError;
    }
    detect() {
      this.detects += 1;
      if (this.detectError) throw this.detectError;
      return this.points;
    }
    dispose() {
      this.disposed = true;
    }
  }

  function setup() {
    const engine = new FakeEngine();
    const source: FrameSource = { video: {} as HTMLVideoElement, dispose: vi.fn() };
    const jobs: Array<() => void> = [];
    const session = new CameraCheckSession({
      createEngine: () => engine,
      createFrameSource: vi.fn(async () => source),
      now: () => 1000,
      schedule: (fn) => jobs.push(fn),
      cancel: () => undefined,
    });
    const stream = asStream(new FakeStream([new FakeTrack('video')]));
    const tick = () => jobs.shift()?.();
    return { engine, source, session, stream, tick, jobs };
  }

  it('does nothing until started, then analyses frames on a timer', async () => {
    const { engine, session, stream, tick } = setup();
    expect(session.getState().status).toBe('idle');
    expect(engine.detects).toBe(0);
    await session.start(stream, true);
    expect(session.getState().status).toBe('running');
    tick();
    expect(session.getState().facePresent).toBe(true);
    expect(session.getState().metrics?.size).toBeCloseTo(0.3);
    expect(INTERVAL_MS).toBeGreaterThanOrEqual(200);
  });

  it('shows a clear missing-model status', async () => {
    const { engine, session, stream } = setup();
    engine.loadError = new FaceModelMissingError('x');
    await session.start(stream, true);
    expect(session.getState().status).toBe('model-missing');
    expect(session.getState().failure?.recovery).toMatch(/fetch:face-model/);
    expect(engine.disposed).toBe(true);
  });

  it('reports no camera without loading anything', async () => {
    const { engine, session } = setup();
    const spy = vi.spyOn(engine, 'load');
    await session.start(asStream(new FakeStream([new FakeTrack('audio')])), true);
    expect(session.getState().status).toBe('error');
    expect(spy).not.toHaveBeenCalled();
  });

  it('does not analyse while the camera is off and resumes when it is on', async () => {
    const { engine, session, stream, tick } = setup();
    await session.start(stream, true);
    tick();
    session.setCameraEnabled(false);
    expect(session.getState()).toMatchObject({ status: 'camera-off', metrics: null });
    const before = engine.detects;
    tick();
    expect(engine.detects).toBe(before);
    session.setCameraEnabled(true);
    tick();
    expect(engine.detects).toBe(before + 1);
  });

  it('clears metrics when the face leaves the frame but remembers one was seen', async () => {
    const { engine, session, stream, tick } = setup();
    await session.start(stream, true);
    tick();
    engine.points = null;
    tick();
    expect(session.getState()).toMatchObject({ metrics: null, facePresent: true });
  });

  it('calibrates from the current pose, only when a face is visible', async () => {
    const { engine, session, stream, tick } = setup();
    await session.start(stream, true);
    expect(session.calibrate()).toBe(false);
    engine.points = face({ 1: { y: 0.64 } });
    tick();
    expect(session.getState().metrics!.pitch).toBeLessThan(-3);
    expect(session.calibrate()).toBe(true);
    for (let i = 0; i < 12; i += 1) tick();
    expect(Math.abs(session.getState().metrics!.pitch)).toBeLessThan(1);
    expect(session.getState().calibrated).toBe(true);
  });

  it('stops after repeated failures and releases everything on stop', async () => {
    const { engine, source, session, stream, tick } = setup();
    await session.start(stream, true);
    engine.detectError = new Error('boom');
    for (let i = 0; i < 5; i += 1) tick();
    expect(session.getState().status).toBe('error');
    expect(engine.disposed).toBe(true);
    expect(source.dispose).toHaveBeenCalled();

    const again = setup();
    await again.session.start(again.stream, true);
    again.session.stop();
    expect(again.engine.disposed).toBe(true);
    expect(again.session.getState()).toMatchObject({ status: 'idle', metrics: null, calibrated: false });
    again.tick();
    expect(again.engine.detects).toBe(0);
  });
});

describe('createMediaPipeEngine', () => {
  const cfg = getFaceModelConfig({}, '/');

  it('defaults to a model file served from this origin', () => {
    expect(cfg).toEqual({ wasmPath: '/mediapipe/wasm', modelPath: '/models/face_landmarker.task' });
    expect(getFaceModelConfig({ VITE_FACE_MODEL_URL: 'https://h/x.task' }, '/').modelPath).toBe('https://h/x.task');
  });

  it('reports a missing model, including the dev server answering with HTML, without loading MediaPipe', async () => {
    const loadVision = vi.fn();
    const html = vi.fn(async () => new Response('', { headers: { 'content-type': 'text/html' } }));
    await expect(createMediaPipeEngine(cfg, loadVision, html).load()).rejects.toBeInstanceOf(FaceModelMissingError);
    const notFound = vi.fn(async () => new Response('', { status: 404 }));
    await expect(createMediaPipeEngine(cfg, loadVision, notFound).load()).rejects.toBeInstanceOf(FaceModelMissingError);
    const offline = vi.fn(async () => Promise.reject(new TypeError('x')));
    await expect(createMediaPipeEngine(cfg, loadVision, offline).load()).rejects.toBeInstanceOf(FaceModelMissingError);
    expect(loadVision).not.toHaveBeenCalled();
  });

  it('creates the landmarker, falls back from GPU to CPU, and passes increasing timestamps', async () => {
    const detectForVideo = vi.fn(() => ({ faceLandmarks: [[{ x: 0.1, y: 0.2 }]] }));
    const close = vi.fn();
    const createFromOptions = vi
      .fn()
      .mockRejectedValueOnce(new Error('no gpu'))
      .mockResolvedValueOnce({ detectForVideo, close });
    const vision = {
      FilesetResolver: { forVisionTasks: vi.fn(async () => ({})) },
      FaceLandmarker: { createFromOptions },
    };
    const ok = vi.fn(async () => new Response('', { headers: { 'content-type': 'application/octet-stream' } }));
    const engine = createMediaPipeEngine(cfg, async () => vision as never, ok);
    await engine.load();
    expect(createFromOptions.mock.calls.map((c) => c[1].baseOptions.delegate)).toEqual(['GPU', 'CPU']);
    expect(vision.FilesetResolver.forVisionTasks).toHaveBeenCalledWith('/mediapipe/wasm');
    expect(engine.detect({} as HTMLVideoElement, 100)).toEqual([{ x: 0.1, y: 0.2 }]);
    engine.detect({} as HTMLVideoElement, 100);
    const stamps = detectForVideo.mock.calls.map((c) => (c as unknown[])[1] as number);
    expect(stamps[1]).toBeGreaterThan(stamps[0]!);
    engine.dispose();
    expect(close).toHaveBeenCalled();
    expect(engine.detect({} as HTMLVideoElement, 5)).toBeNull();
  });
});
