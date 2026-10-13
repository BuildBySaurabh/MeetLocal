import { describe, expect, it, vi } from 'vitest';
import { asStream, makeStream } from '../../test/fakes';
import { classifyMediaError, requestLocalMedia, stopStream } from './media.service';

const domError = (name: string) => Object.assign(new Error(name), { name });

function devices(impl: (constraints: MediaStreamConstraints) => Promise<unknown>) {
  const getUserMedia = vi.fn(impl);
  return { api: { getUserMedia } as unknown as MediaDevices, getUserMedia };
}

describe('classifyMediaError', () => {
  it.each([
    ['NotAllowedError', 'permission-denied'],
    ['SecurityError', 'permission-denied'],
    ['NotFoundError', 'no-device'],
    ['OverconstrainedError', 'no-device'],
    ['NotReadableError', 'device-in-use'],
    ['AbortError', 'device-in-use'],
    ['TypeError', 'unsupported'],
    ['NotSupportedError', 'unsupported'],
    ['SomethingElse', 'unknown'],
  ])('maps %s to %s', (name, kind) => {
    expect(classifyMediaError(domError(name)).kind).toBe(kind);
  });

  it('handles non-error values and always includes a recovery action', () => {
    const failure = classifyMediaError('boom');
    expect(failure.kind).toBe('unknown');
    expect(failure.recovery.length).toBeGreaterThan(0);
  });
});

describe('requestLocalMedia', () => {
  it('reports unsupported when mediaDevices is unavailable', async () => {
    const result = await requestLocalMedia(undefined);
    expect(result).toMatchObject({
      ok: false,
      failure: { kind: expect.stringMatching(/unsupported|insecure-context/) },
    });
  });

  it('returns the stream when both devices open', async () => {
    const stream = makeStream();
    const { api } = devices(async () => asStream(stream));
    const result = await requestLocalMedia(api);
    expect(result).toEqual({ ok: true, stream, missing: [] });
  });

  it('does not retry when permission is denied', async () => {
    const { api, getUserMedia } = devices(async () => {
      throw domError('NotAllowedError');
    });
    const result = await requestLocalMedia(api);
    expect(result).toMatchObject({ ok: false, failure: { kind: 'permission-denied' } });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('reports a device that is already in use', async () => {
    const { api } = devices(async () => {
      throw domError('NotReadableError');
    });
    expect(await requestLocalMedia(api)).toMatchObject({ ok: false, failure: { kind: 'device-in-use' } });
  });

  it('falls back to microphone only when there is no camera', async () => {
    const audio = makeStream(['audio']);
    const { api } = devices(async (constraints) => {
      if (constraints.video) throw domError('NotFoundError');
      return asStream(audio);
    });
    expect(await requestLocalMedia(api)).toEqual({ ok: true, stream: audio, missing: ['camera'] });
  });

  it('falls back to camera only when there is no microphone', async () => {
    const video = makeStream(['video']);
    const { api } = devices(async (constraints) => {
      if (constraints.audio) throw domError('NotFoundError');
      return asStream(video);
    });
    expect(await requestLocalMedia(api)).toEqual({ ok: true, stream: video, missing: ['microphone'] });
  });

  it('fails with no-device when nothing is available', async () => {
    const { api } = devices(async () => {
      throw domError('NotFoundError');
    });
    expect(await requestLocalMedia(api)).toMatchObject({ ok: false, failure: { kind: 'no-device' } });
  });
});

describe('stopStream', () => {
  it('stops every track and tolerates null', () => {
    const stream = makeStream();
    stopStream(asStream(stream));
    expect(stream.tracks.every((t) => t.stopped)).toBe(true);
    expect(() => stopStream(null)).not.toThrow();
  });
});
