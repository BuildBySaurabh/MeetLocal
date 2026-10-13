import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeStream, FakeTrack, asStream } from '../../test/fakes';
import { startLevelMeter, type AudioContextLike } from './audioLevel';
import { listDevices, watchDevices } from './deviceManager';
import { requestScreenShare, requestTrack } from './media.service';
import { loadDevicePreferences, saveDevicePreference } from '../../services/preferences';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const domError = (name: string) => Object.assign(new Error(name), { name });

describe('listDevices', () => {
  it('groups devices by kind and labels unnamed ones', async () => {
    const api = {
      enumerateDevices: async () => [
        { kind: 'videoinput', deviceId: 'c1', label: '' },
        { kind: 'audioinput', deviceId: 'm1', label: 'USB Mic' },
        { kind: 'audiooutput', deviceId: 's1', label: '' },
      ],
    } as unknown as MediaDevices;
    const lists = await listDevices(api);
    expect(lists.cameras).toEqual([{ deviceId: 'c1', label: 'Camera 1' }]);
    expect(lists.microphones[0]?.label).toBe('USB Mic');
    expect(lists.speakers[0]?.label).toBe('Speaker 1');
    expect(lists.labelsAvailable).toBe(true);
  });

  it('reports no labels before permission, and nothing when unsupported', async () => {
    const api = {
      enumerateDevices: async () => [{ kind: 'videoinput', deviceId: '', label: '' }],
    } as unknown as MediaDevices;
    expect((await listDevices(api)).labelsAvailable).toBe(false);
    expect((await listDevices(undefined)).cameras).toEqual([]);
  });

  it('watchDevices subscribes and unsubscribes', () => {
    const add = vi.fn();
    const remove = vi.fn();
    const stop = watchDevices(() => undefined, {
      addEventListener: add,
      removeEventListener: remove,
    } as unknown as MediaDevices);
    expect(add).toHaveBeenCalledWith('devicechange', expect.any(Function));
    stop();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe('requestTrack', () => {
  it('asks for exactly the chosen device and returns its track', async () => {
    const getUserMedia = vi.fn(async () => new FakeStream([new FakeTrack('video', 'c2')]));
    const result = await requestTrack('video', 'c2', {
      getUserMedia,
    } as unknown as MediaDevices);
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { deviceId: { exact: 'c2' } },
    });
    expect(result.ok).toBe(true);
  });

  it('classifies failures', async () => {
    const getUserMedia = vi.fn(async () => {
      throw domError('NotReadableError');
    });
    const result = await requestTrack('audio', 'm2', {
      getUserMedia,
    } as unknown as MediaDevices);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('device-in-use');
  });
});

describe('requestScreenShare', () => {
  it('returns the stream on success', async () => {
    const stream = asStream(new FakeStream([new FakeTrack('video')]));
    const result = await requestScreenShare({
      getDisplayMedia: async () => stream,
    } as unknown as MediaDevices);
    expect(result).toEqual({ ok: true, stream });
  });

  it('treats closing the picker as a cancellation, not an error', async () => {
    const api = {
      getDisplayMedia: async () => {
        throw domError('NotAllowedError');
      },
    } as unknown as MediaDevices;
    const result = await requestScreenShare(api);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.cancelled).toBe(true);
  });

  it('explains when unsupported and when capture fails otherwise', async () => {
    const unsupported = await requestScreenShare({} as MediaDevices);
    expect(!unsupported.ok && unsupported.cancelled).toBe(false);
    const failing = await requestScreenShare({
      getDisplayMedia: async () => {
        throw domError('NotReadableError');
      },
    } as unknown as MediaDevices);
    expect(!failing.ok && failing.cancelled).toBe(false);
  });
});

describe('startLevelMeter', () => {
  function fakeContext(sample: number) {
    const disconnect = vi.fn();
    const close = vi.fn(async () => undefined);
    const context: AudioContextLike = {
      state: 'running',
      createMediaStreamSource: () => ({ connect: vi.fn(), disconnect }),
      createAnalyser: () => ({
        fftSize: 0,
        getByteTimeDomainData: (data: Uint8Array) => data.fill(sample),
      }),
      resume: async () => undefined,
      close,
    };
    return { context, disconnect, close };
  }

  it('reports silence as 0 and loud audio as a high level, then cleans up', () => {
    vi.useFakeTimers();
    const levels: number[] = [];
    const loud = fakeContext(255);
    const meter = startLevelMeter(
      asStream(new FakeStream([new FakeTrack('audio')])),
      (l) => levels.push(l),
      () => loud.context,
    );
    vi.advanceTimersByTime(100);
    expect(levels.at(-1)).toBe(1);
    meter?.stop();
    expect(loud.close).toHaveBeenCalled();
    expect(loud.disconnect).toHaveBeenCalled();
    expect(levels.at(-1)).toBe(0);

    const quiet: number[] = [];
    const silent = fakeContext(128);
    startLevelMeter(
      asStream(new FakeStream([new FakeTrack('audio')])),
      (l) => quiet.push(l),
      () => silent.context,
    )?.stop();
    expect(quiet.every((l) => l === 0)).toBe(true);
  });

  it('returns null without an audio track or Web Audio', () => {
    expect(
      startLevelMeter(
        asStream(new FakeStream([new FakeTrack('video')])),
        () => undefined,
        () => fakeContext(128).context,
      ),
    ).toBeNull();
    expect(
      startLevelMeter(
        asStream(new FakeStream([new FakeTrack('audio')])),
        () => undefined,
        () => null,
      ),
    ).toBeNull();
  });
});

describe('device preferences', () => {
  it('round-trips and removes a device choice', () => {
    expect(saveDevicePreference('cameraId', 'c9')).toBe(true);
    saveDevicePreference('speakerId', 's9');
    expect(loadDevicePreferences()).toEqual({
      cameraId: 'c9',
      speakerId: 's9',
    });
    saveDevicePreference('cameraId', '');
    expect(loadDevicePreferences()).toEqual({ speakerId: 's9' });
  });
});
