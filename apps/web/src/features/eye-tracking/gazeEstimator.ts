import type { Baseline, EyeDirection, FaceMetrics, HeadDirection, Landmark } from './gaze.types';

// Indices in MediaPipe's 478-point face mesh (468 mesh points + 10 iris points).
const NOSE_TIP = 1;
const NOSE_BRIDGE = 168;
const CHIN = 152;
const CHEEK_A = 234; // image-left cheek (unmirrored)
const CHEEK_B = 454; // image-right cheek
const EYE_OUTER_A = 33; // image-left eye (the person's right eye): outer corner
const EYE_INNER_A = 133;
const EYE_INNER_B = 362; // image-right eye (the person's left eye): inner corner
const EYE_OUTER_B = 263;
const IRIS_A = 468;
const IRIS_B = 473;
const LID_TOP_A = 159;
const LID_BOTTOM_A = 145;
const LID_TOP_B = 386;
const LID_BOTTOM_B = 374;

export const LANDMARK_COUNT = 478;

/** Typical nose-tip position between nose bridge (0) and chin (1) for a camera-facing head. A guess; calibration replaces it. */
export const DEFAULT_PITCH_RATIO = 0.6;
const PITCH_DEGREES_PER_RATIO = 120;

const deg = (rad: number) => (rad * 180) / Math.PI;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const dist = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y);

/** The raw, uncalibrated measurements; `estimate` turns them into metrics. */
export interface RawMeasure {
  pitchRatio: number;
  eyeX: number | null;
  eyeY: number | null;
}

function eyeFraction(iris: Landmark, c1: Landmark, c2: Landmark): number {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const len2 = dx * dx + dy * dy;
  return len2 === 0 ? 0.5 : ((iris.x - c1.x) * dx + (iris.y - c1.y) * dy) / len2;
}

export function measure(points: Landmark[]): RawMeasure | null {
  if (points.length < LANDMARK_COUNT) return null;
  const p = (i: number) => points[i] as Landmark;
  const span = p(CHIN).y - p(NOSE_BRIDGE).y;
  if (span <= 0) return null;
  const pitchRatio = (p(NOSE_TIP).y - p(NOSE_BRIDGE).y) / span;

  // Horizontal eye direction: where the iris sits along the line between the eye corners.
  const tA = eyeFraction(p(IRIS_A), p(EYE_OUTER_A), p(EYE_INNER_A));
  const tB = eyeFraction(p(IRIS_B), p(EYE_INNER_B), p(EYE_OUTER_B));
  // 0.5 is centred; smaller = toward image-left = toward the person's right, hence the sign flip.
  const eyeX = clamp(-((tA + tB) / 2 - 0.5) * 2, -1, 1);

  // Vertical: iris between the lids. Skipped while the eyes are nearly closed (blink).
  const openA = dist(p(LID_TOP_A), p(LID_BOTTOM_A)) / (dist(p(EYE_OUTER_A), p(EYE_INNER_A)) || 1);
  const openB = dist(p(LID_TOP_B), p(LID_BOTTOM_B)) / (dist(p(EYE_OUTER_B), p(EYE_INNER_B)) || 1);
  let eyeY: number | null = null;
  if (openA > 0.12 && openB > 0.12) {
    const vA = (p(IRIS_A).y - p(LID_TOP_A).y) / (p(LID_BOTTOM_A).y - p(LID_TOP_A).y);
    const vB = (p(IRIS_B).y - p(LID_TOP_B).y) / (p(LID_BOTTOM_B).y - p(LID_TOP_B).y);
    eyeY = clamp(-((vA + vB) / 2 - 0.5) * 2, -1, 1);
  }
  return { pitchRatio, eyeX, eyeY };
}

/** Converts landmarks into approximate head pose, eye direction and framing. Pure. Null if the data is unusable. */
export function estimate(points: Landmark[], baseline?: Baseline | null): FaceMetrics | null {
  const raw = measure(points);
  if (!raw) return null;
  const p = (i: number) => points[i] as Landmark;

  // Yaw: how far the nose tip sits from the midpoint of the cheeks, relative to half the face width.
  const halfWidth = (p(CHEEK_B).x - p(CHEEK_A).x) / 2;
  if (halfWidth <= 0) return null;
  const midX = (p(CHEEK_A).x + p(CHEEK_B).x) / 2;
  const yawRatio = clamp((p(NOSE_TIP).x - midX) / halfWidth, -1, 1);
  // The image is unmirrored: the nose moving toward image-left means the person turned to their right.
  const yaw = -deg(Math.asin(yawRatio));

  const neutralPitch = baseline?.pitch ?? DEFAULT_PITCH_RATIO;
  // Chin raised makes the nose tip sit relatively higher between bridge and chin (a smaller ratio).
  const pitch = (neutralPitch - raw.pitchRatio) * PITCH_DEGREES_PER_RATIO;

  const roll = deg(Math.atan2(p(EYE_INNER_B).y - p(EYE_INNER_A).y, p(EYE_INNER_B).x - p(EYE_INNER_A).x));

  let left = 1;
  let top = 1;
  let right = 0;
  let bottom = 0;
  for (const point of points) {
    left = Math.min(left, point.x);
    right = Math.max(right, point.x);
    top = Math.min(top, point.y);
    bottom = Math.max(bottom, point.y);
  }
  const margin = 0.01;
  const outsideFrame = left < margin || top < margin || right > 1 - margin || bottom > 1 - margin;

  return {
    yaw,
    pitch,
    roll,
    eyeX: raw.eyeX === null ? null : raw.eyeX - (baseline?.eyeX ?? 0),
    eyeY: raw.eyeY === null ? null : raw.eyeY - (baseline?.eyeY ?? 0),
    box: { left, top, right, bottom },
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
    size: bottom - top,
    outsideFrame,
  };
}

/** Wide tolerances on purpose: the estimate is coarse. */
export function headDirection(m: FaceMetrics): HeadDirection {
  if (m.yaw > 20) return 'turned-right';
  if (m.yaw < -20) return 'turned-left';
  return 'facing';
}

export function eyeDirection(m: FaceMetrics): EyeDirection {
  if (m.eyeX === null || m.eyeY === null) return 'unknown';
  const ax = Math.abs(m.eyeX);
  const ay = Math.abs(m.eyeY);
  if (ax < 0.3 && ay < 0.4) return 'center';
  if (ax >= ay * 0.75) return m.eyeX > 0 ? 'right' : 'left';
  return m.eyeY > 0 ? 'up' : 'down';
}

/** Practical framing tips. These are about the camera set-up only, never about behaviour or attention. */
export function cameraSuggestions(m: FaceMetrics | null): string[] {
  if (!m) return [];
  const tips: string[] = [];
  if (m.outsideFrame)
    tips.push('Part of your face is outside the camera frame. Move or tilt the camera so your whole face fits.');
  if (m.size < 0.25) tips.push('You look small in the frame. Move closer to the camera.');
  else if (m.size > 0.8) tips.push('You are very close to the camera. Move back a little.');
  if (m.centerX < 0.3 || m.centerX > 0.7) tips.push('Move toward the middle of the frame.');
  if (Math.abs(m.roll) > 15) tips.push('The camera or your head is tilted sideways. Level the camera if it is tilted.');
  if (Math.abs(m.yaw) > 25)
    tips.push(
      'The camera sees your face from the side. Place the camera in front of you if you usually look at your screen.',
    );
  return tips;
}

/** Exponential smoothing so numbers do not jitter on screen. */
export function smooth(previous: FaceMetrics | null, next: FaceMetrics, alpha = 0.4): FaceMetrics {
  if (!previous) return next;
  const mix = (a: number, b: number) => a + (b - a) * alpha;
  const mixN = (a: number | null, b: number | null) => (a === null || b === null ? b : mix(a, b));
  return {
    yaw: mix(previous.yaw, next.yaw),
    pitch: mix(previous.pitch, next.pitch),
    roll: mix(previous.roll, next.roll),
    eyeX: mixN(previous.eyeX, next.eyeX),
    eyeY: mixN(previous.eyeY, next.eyeY),
    box: next.box,
    centerX: mix(previous.centerX, next.centerX),
    centerY: mix(previous.centerY, next.centerY),
    size: mix(previous.size, next.size),
    outsideFrame: next.outsideFrame,
  };
}
