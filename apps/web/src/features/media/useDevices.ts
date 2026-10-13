import { useCallback, useEffect, useState } from 'react';
import { listDevices, watchDevices, type DeviceLists } from './deviceManager';

const EMPTY: DeviceLists = { cameras: [], microphones: [], speakers: [], labelsAvailable: false };

/** Device lists that refresh when devices are plugged in or removed. Never prompts for permission. */
export function useDevices(refreshKey?: unknown): { devices: DeviceLists; refresh: () => void } {
  const [devices, setDevices] = useState<DeviceLists>(EMPTY);
  const refresh = useCallback(() => {
    listDevices()
      .then(setDevices)
      .catch((error: unknown) => console.warn('Could not list devices', error));
  }, []);
  // refreshKey lets callers re-list after permission is granted (labels appear only then).
  useEffect(() => {
    refresh();
    return watchDevices(refresh);
  }, [refresh, refreshKey]);
  return { devices, refresh };
}
