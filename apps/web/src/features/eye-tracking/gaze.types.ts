/** A landmark in normalized image coordinates (0..1) of the UNMIRRORED camera image. */
export interface Landmark {
  x: number;
  y: number;
  z?: number;
}

/**
 * Everything here is an approximation computed on this device from one face-landmark model. It is
 * shown only to the person using the camera. It is not a measure of attention, honesty, effort or
 * ability, and must never be presented as one.
 */
export interface FaceMetrics {
  /** Degrees. Positive = turned toward YOUR right. */
  yaw: number;
  /** Degrees, relative to the calibrated (or default) neutral pose. Positive = chin up. */
  pitch: number;
  /** Degrees. Positive = your left ear moves down (image-right side lower). */
  roll: number;
  /** -1..1 where eyes point relative to the head. Positive = toward YOUR right. Null while blinking/unknown. */
  eyeX: number | null;
  /** -1..1. Positive = up. Null while blinking/unknown. */
  eyeY: number | null;
  /** Face bounding box in normalized image coordinates. */
  box: { left: number; top: number; right: number; bottom: number };
  /** Face centre as a fraction of the image (0.5 = middle). */
  centerX: number;
  centerY: number;
  /** Face height as a fraction of the image height. */
  size: number;
  /** Part of the face reaches or crosses the edge of the image. */
  outsideFrame: boolean;
}

export type HeadDirection = 'facing' | 'turned-left' | 'turned-right';
export type EyeDirection = 'center' | 'left' | 'right' | 'up' | 'down' | 'unknown';

export interface Baseline {
  pitch: number;
  eyeX: number;
  eyeY: number;
}

export type CameraCheckStatus = 'idle' | 'loading-model' | 'running' | 'camera-off' | 'model-missing' | 'error';

export interface CameraCheckFailure {
  message: string;
  recovery: string;
}

export interface CameraCheckState {
  status: CameraCheckStatus;
  failure: CameraCheckFailure | null;
  /** True once a face has been seen at least once in this run. */
  facePresent: boolean;
  /** Latest smoothed metrics; null when no face is visible. */
  metrics: FaceMetrics | null;
  calibrated: boolean;
}
