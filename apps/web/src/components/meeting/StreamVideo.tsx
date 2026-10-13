import { useEffect, useRef, useState } from 'react';

interface StreamVideoProps {
  stream: MediaStream | null;
  /** Mute playback. Always true for the local stream to avoid echo. */
  muted?: boolean;
  /** Mirror horizontally (self-view convention). */
  mirror?: boolean;
  /** Keep playing (audio) but do not show the picture. */
  hidden?: boolean;
  /** Show the whole picture (letterboxed) instead of cropping, e.g. for shared screens. */
  contain?: boolean;
  /** Output device for audio (speaker selection). Ignored where the browser lacks setSinkId. */
  sinkId?: string;
  label: string;
}

type SinkVideo = HTMLVideoElement & {
  setSinkId?: (id: string) => Promise<void>;
};

/** Attaches a MediaStream to a <video> element and handles autoplay restrictions. */
export function StreamVideo({
  stream,
  muted = false,
  mirror = false,
  hidden = false,
  contain = false,
  sinkId,
  label,
}: StreamVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [needsGesture, setNeedsGesture] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    setNeedsGesture(false);
    if (stream) {
      const playing = video.play() as Promise<void> | undefined;
      playing?.catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'NotAllowedError') setNeedsGesture(true);
        // AbortError just means the stream was swapped or removed while play() was pending.
        else if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.warn('Video playback failed', error);
        }
      });
    }
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  useEffect(() => {
    const video = videoRef.current as SinkVideo | null;
    if (!video || !sinkId || typeof video.setSinkId !== 'function') return;
    video.setSinkId(sinkId).catch((error: unknown) => console.warn('Could not switch speaker', error));
  }, [sinkId, stream]);

  return (
    <>
      <video
        ref={videoRef}
        className={`stream-video${mirror ? ' stream-video--mirror' : ''}${hidden ? ' stream-video--hidden' : ''}${contain ? ' stream-video--contain' : ''}`}
        autoPlay
        playsInline
        muted={muted}
        aria-label={label}
      />
      {needsGesture ? (
        <button
          type="button"
          className="btn btn--secondary btn--sm stream-video__play"
          onClick={() => {
            const playing = videoRef.current?.play() as Promise<void> | undefined;
            playing
              ?.then(() => setNeedsGesture(false))
              .catch((error: unknown) => console.warn('Playback failed', error));
          }}
        >
          Click to start playback
        </button>
      ) : null}
    </>
  );
}
