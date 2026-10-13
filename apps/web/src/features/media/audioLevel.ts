import { useEffect, useState } from 'react';

/** The slice of Web Audio we use, so tests can substitute a fake. */
export interface AudioContextLike {
  state: string;
  createMediaStreamSource(stream: MediaStream): { connect(node: unknown): void; disconnect(): void };
  createAnalyser(): { fftSize: number; getByteTimeDomainData(data: Uint8Array): void };
  resume(): Promise<void>;
  close(): Promise<void>;
}

export interface LevelMeter {
  stop(): void;
}

const POLL_MS = 100;

/**
 * Measures the loudness of a stream's audio, locally. Samples never leave the page and are not
 * recorded; only a 0..1 level is produced. Returns null if the stream has no audio track or Web
 * Audio is unavailable.
 */
export function startLevelMeter(
  stream: MediaStream,
  onLevel: (level: number) => void,
  createContext: () => AudioContextLike | null = () =>
    typeof AudioContext === 'undefined' ? null : (new AudioContext() as unknown as AudioContextLike),
): LevelMeter | null {
  if (stream.getAudioTracks().length === 0) return null;
  const context = createContext();
  if (!context) return null;

  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  if (context.state === 'suspended') {
    context.resume().catch((error: unknown) => console.warn('Could not resume audio meter', error));
  }

  const samples = new Uint8Array(analyser.fftSize);
  const timer = setInterval(() => {
    analyser.getByteTimeDomainData(samples);
    let sumSquares = 0;
    for (const sample of samples) {
      const centred = (sample - 128) / 128;
      sumSquares += centred * centred;
    }
    const rms = Math.sqrt(sumSquares / samples.length);
    onLevel(Math.min(1, rms * 4));
  }, POLL_MS);

  return {
    stop() {
      clearInterval(timer);
      source.disconnect();
      context.close().catch((error: unknown) => console.warn('Could not close audio meter', error));
      onLevel(0);
    },
  };
}

/** Live 0..1 microphone level for a stream (0 when there is no stream or audio track). */
export function useAudioLevel(stream: MediaStream | null): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!stream) {
      setLevel(0);
      return;
    }
    const meter = startLevelMeter(stream, setLevel);
    return () => meter?.stop();
  }, [stream]);
  return level;
}
