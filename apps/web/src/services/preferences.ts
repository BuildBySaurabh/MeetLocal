import { displayNameSchema } from '@meetlocal/shared';

/**
 * Small, non-sensitive preferences live in localStorage. Larger data (transcripts, notes)
 * will use IndexedDB in later phases. Browser storage is not encrypted.
 */
const DISPLAY_NAME_KEY = 'meetlocal.displayName';
const CAMERA_KEY = 'meetlocal.cameraId';
const MICROPHONE_KEY = 'meetlocal.microphoneId';
const SPEAKER_KEY = 'meetlocal.speakerId';
const ALL_KEYS = [DISPLAY_NAME_KEY, CAMERA_KEY, MICROPHONE_KEY, SPEAKER_KEY];

export function validateDisplayName(value: string): { ok: true; value: string } | { ok: false; error: string } {
  const result = displayNameSchema.safeParse(value);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: result.error.issues[0]?.message ?? 'Invalid name' };
}

export function loadDisplayName(): string {
  try {
    const stored = window.localStorage.getItem(DISPLAY_NAME_KEY) ?? '';
    return validateDisplayName(stored).ok ? stored : '';
  } catch (error) {
    // Storage can be blocked (private mode, policy). Preferences are optional, so degrade gracefully.
    console.warn('Could not read saved preferences', error);
    return '';
  }
}

/** Returns false if the preference could not be saved. */
export function saveDisplayName(name: string): boolean {
  try {
    window.localStorage.setItem(DISPLAY_NAME_KEY, name);
    return true;
  } catch (error) {
    console.warn('Could not save preferences', error);
    return false;
  }
}

/** Removes every MeetLocal preference from this browser. Returns false on failure. */
export function clearPreferences(): boolean {
  try {
    for (const key of ALL_KEYS) window.localStorage.removeItem(key);
    return true;
  } catch (error) {
    console.warn('Could not clear preferences', error);
    return false;
  }
}

export interface DevicePreferences {
  cameraId?: string;
  microphoneId?: string;
  speakerId?: string;
}

const DEVICE_KEYS = { cameraId: CAMERA_KEY, microphoneId: MICROPHONE_KEY, speakerId: SPEAKER_KEY } as const;

/** Saved device choices (device IDs only; no labels or media). */
export function loadDevicePreferences(): DevicePreferences {
  const prefs: DevicePreferences = {};
  try {
    for (const [field, key] of Object.entries(DEVICE_KEYS) as Array<[keyof DevicePreferences, string]>) {
      const value = window.localStorage.getItem(key);
      if (value) prefs[field] = value;
    }
  } catch (error) {
    console.warn('Could not read saved device preferences', error);
  }
  return prefs;
}

/** Saves (or, with an empty value, removes) one device preference. Returns false on failure. */
export function saveDevicePreference(field: keyof DevicePreferences, deviceId: string): boolean {
  try {
    if (deviceId) window.localStorage.setItem(DEVICE_KEYS[field], deviceId);
    else window.localStorage.removeItem(DEVICE_KEYS[field]);
    return true;
  } catch (error) {
    console.warn('Could not save device preference', error);
    return false;
  }
}
