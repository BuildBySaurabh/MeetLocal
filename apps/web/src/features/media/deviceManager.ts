export interface DeviceInfo {
  deviceId: string;
  label: string;
}

export interface DeviceLists {
  cameras: DeviceInfo[];
  microphones: DeviceInfo[];
  speakers: DeviceInfo[];
  /** Browsers hide device names until camera/microphone permission has been granted. */
  labelsAvailable: boolean;
}

const EMPTY: DeviceLists = { cameras: [], microphones: [], speakers: [], labelsAvailable: false };

function toInfo(device: MediaDeviceInfo, fallbackPrefix: string, index: number): DeviceInfo {
  return { deviceId: device.deviceId, label: device.label || `${fallbackPrefix} ${index + 1}` };
}

/** Lists cameras, microphones and speakers. Never prompts for permission. */
export async function listDevices(
  devices: MediaDevices | undefined = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices,
): Promise<DeviceLists> {
  if (!devices || typeof devices.enumerateDevices !== 'function') return EMPTY;
  const all = await devices.enumerateDevices();
  const ofKind = (kind: MediaDeviceKind) => all.filter((d) => d.kind === kind);
  return {
    cameras: ofKind('videoinput').map((d, i) => toInfo(d, 'Camera', i)),
    microphones: ofKind('audioinput').map((d, i) => toInfo(d, 'Microphone', i)),
    speakers: ofKind('audiooutput').map((d, i) => toInfo(d, 'Speaker', i)),
    labelsAvailable: all.some((d) => d.label !== ''),
  };
}

/** Calls `onChange` when a device is plugged in or removed. Returns an unsubscribe function. */
export function watchDevices(
  onChange: () => void,
  devices: MediaDevices | undefined = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices,
): () => void {
  if (!devices || typeof devices.addEventListener !== 'function') return () => undefined;
  devices.addEventListener('devicechange', onChange);
  return () => devices.removeEventListener('devicechange', onChange);
}

/** Speaker (output) selection is not available in every browser (notably Safari and Firefox). */
export function supportsSpeakerSelection(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}
