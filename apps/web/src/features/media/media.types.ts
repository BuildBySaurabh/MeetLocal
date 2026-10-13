export type MediaFailureKind =
  'permission-denied' | 'no-device' | 'device-in-use' | 'insecure-context' | 'unsupported' | 'unknown';

export interface MediaFailure {
  kind: MediaFailureKind;
  /** What happened, in plain language. */
  message: string;
  /** What the user can do about it. */
  recovery: string;
}

export type MissingDevice = 'camera' | 'microphone';

export type MediaResult =
  | {
      ok: true;
      stream: MediaStream;
      /** Devices that were not available; the stream contains whatever could be opened. */
      missing: MissingDevice[];
    }
  | { ok: false; failure: MediaFailure };

export interface PreferredDevices {
  cameraId?: string;
  microphoneId?: string;
}

export type ScreenResult =
  | { ok: true; stream: MediaStream }
  /** `cancelled` is true when the user dismissed the picker (not an error worth alarming them about). */
  | { ok: false; cancelled: boolean; message: string };

export type TrackResult = { ok: true; track: MediaStreamTrack } | { ok: false; failure: MediaFailure };
