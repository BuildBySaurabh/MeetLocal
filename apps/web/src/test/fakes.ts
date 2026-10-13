// Shared test doubles for browser media APIs. jsdom has no MediaStream or RTCPeerConnection.
// These fakes let unit tests exercise our logic; they do NOT prove real calls work.

export class FakeTrack {
  enabled = true;
  stopped = false;
  onended: (() => void) | null = null;
  constructor(
    public kind: 'audio' | 'video',
    public deviceId: string = `${kind}-default`,
  ) {}
  stop(): void {
    this.stopped = true;
  }
  getSettings() {
    return { deviceId: this.deviceId };
  }
  /** Simulates the device disappearing (the browser fires "ended"). */
  end(): void {
    this.onended?.();
  }
}

export class FakeStream {
  constructor(public tracks: FakeTrack[]) {}
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video');
  }
}

export function makeStream(kinds: Array<'audio' | 'video'> = ['audio', 'video']): FakeStream {
  return new FakeStream(kinds.map((kind) => new FakeTrack(kind)));
}

export const asStream = (stream: FakeStream) => stream as unknown as MediaStream;
export const asTrack = (track: FakeTrack) => track as unknown as MediaStreamTrack;

/** Lets pending promise callbacks run without relying on timers (safe with fake timers). */
export async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}
