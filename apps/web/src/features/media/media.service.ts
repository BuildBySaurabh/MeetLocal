import type {
  MediaFailure,
  MediaFailureKind,
  MediaResult,
  PreferredDevices,
  ScreenResult,
  TrackResult,
} from './media.types';

const FAILURES: Record<MediaFailureKind, Omit<MediaFailure, 'kind'>> = {
  'permission-denied': {
    message: 'Camera or microphone access was blocked.',
    recovery: 'Allow access using the camera icon in your browser address bar (or in site settings), then try again.',
  },
  'no-device': {
    message: 'No camera or microphone was found.',
    recovery: 'Connect a camera or microphone and try again. You can still join to watch and listen.',
  },
  'device-in-use': {
    message: 'Your camera or microphone is being used by another application.',
    recovery: 'Close other apps or tabs that use it (video calls, recorders), then try again.',
  },
  'insecure-context': {
    message: 'This page is not served over a secure connection, so the browser blocks camera and microphone.',
    recovery: 'Open MeetLocal over HTTPS (or on localhost) and try again.',
  },
  unsupported: {
    message: 'This browser does not support camera and microphone access.',
    recovery: 'Use a current version of Chrome, Edge, Firefox or Safari.',
  },
  unknown: {
    message: 'Could not start your camera or microphone.',
    recovery: 'Check your devices and browser permissions, then try again.',
  },
};

export function makeFailure(kind: MediaFailureKind): MediaFailure {
  return { kind, ...FAILURES[kind] };
}

/** Maps a getUserMedia error to a user-facing failure. */
export function classifyMediaError(error: unknown): MediaFailure {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return makeFailure('permission-denied');
    case 'NotFoundError':
    case 'OverconstrainedError':
    case 'DevicesNotFoundError':
      return makeFailure('no-device');
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return makeFailure('device-in-use');
    case 'TypeError':
    case 'NotSupportedError':
      return makeFailure('unsupported');
    default:
      return makeFailure('unknown');
  }
}

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop());
}

type Attempt = { stream: MediaStream } | { error: unknown };

async function attempt(devices: MediaDevices, constraints: MediaStreamConstraints): Promise<Attempt> {
  try {
    return { stream: await devices.getUserMedia(constraints) };
  } catch (error) {
    return { error };
  }
}

/**
 * Opens the local camera and microphone. Must be called in response to a user action.
 * If one device is missing it falls back to the other; permission and in-use errors are not
 * retried because retrying cannot fix them.
 */
export async function requestLocalMedia(
  devices: MediaDevices | undefined = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices,
  preferred: PreferredDevices = {},
): Promise<MediaResult> {
  if (!devices || typeof devices.getUserMedia !== 'function') {
    const insecure = typeof window !== 'undefined' && window.isSecureContext === false;
    return { ok: false, failure: makeFailure(insecure ? 'insecure-context' : 'unsupported') };
  }

  // "ideal" (not "exact") so a saved device that has been unplugged falls back to the default.
  const video: MediaTrackConstraints | boolean = preferred.cameraId
    ? { deviceId: { ideal: preferred.cameraId } }
    : true;
  const audio: MediaTrackConstraints | boolean = preferred.microphoneId
    ? { deviceId: { ideal: preferred.microphoneId } }
    : true;

  const both = await attempt(devices, { video, audio });
  if ('stream' in both) return { ok: true, stream: both.stream, missing: [] };

  const failure = classifyMediaError(both.error);
  if (failure.kind !== 'no-device') return { ok: false, failure };

  const audioOnly = await attempt(devices, { audio });
  if ('stream' in audioOnly) return { ok: true, stream: audioOnly.stream, missing: ['camera'] };
  if (classifyMediaError(audioOnly.error).kind !== 'no-device') {
    return { ok: false, failure: classifyMediaError(audioOnly.error) };
  }

  const videoOnly = await attempt(devices, { video });
  if ('stream' in videoOnly) return { ok: true, stream: videoOnly.stream, missing: ['microphone'] };
  return { ok: false, failure: classifyMediaError(videoOnly.error) };
}

/**
 * Opens one specific device (used when switching camera or microphone mid-call). Uses "exact" so the
 * user gets the device they picked or a clear error, never a silent substitute.
 */
export async function requestTrack(
  kind: 'video' | 'audio',
  deviceId: string,
  devices: MediaDevices | undefined = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices,
): Promise<TrackResult> {
  if (!devices || typeof devices.getUserMedia !== 'function') return { ok: false, failure: makeFailure('unsupported') };
  const result = await attempt(devices, { [kind]: { deviceId: { exact: deviceId } } });
  if ('error' in result) return { ok: false, failure: classifyMediaError(result.error) };
  const track = (kind === 'video' ? result.stream.getVideoTracks() : result.stream.getAudioTracks())[0];
  if (!track) {
    stopStream(result.stream);
    return { ok: false, failure: makeFailure('no-device') };
  }
  return { ok: true, track };
}

/** Starts screen capture. Must be called from a user action. Video only; no system audio is shared. */
export async function requestScreenShare(
  devices: MediaDevices | undefined = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices,
): Promise<ScreenResult> {
  if (!devices || typeof devices.getDisplayMedia !== 'function') {
    return {
      ok: false,
      cancelled: false,
      message:
        'Screen sharing is not supported in this browser. Desktop Chrome, Edge, Firefox and Safari support it; most mobile browsers do not.',
    };
  }
  try {
    const stream = await devices.getDisplayMedia({ video: true, audio: false });
    return { ok: true, stream };
  } catch (error) {
    const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
    // NotAllowedError covers both "user closed the picker" and "blocked by policy".
    if (name === 'NotAllowedError' || name === 'AbortError') {
      return { ok: false, cancelled: true, message: 'Screen sharing was cancelled.' };
    }
    return {
      ok: false,
      cancelled: false,
      message: 'Could not start screen sharing. Check your browser and system screen-recording permissions.',
    };
  }
}
