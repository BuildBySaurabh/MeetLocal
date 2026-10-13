import { MicOff, MonitorUp, VideoOff } from 'lucide-react';
import { StreamVideo } from './StreamVideo';

interface VideoTileProps {
  name: string;
  isLocal?: boolean;
  stream?: MediaStream | null;
  /** Whether a picture should be shown (camera on / remote video present). */
  showVideo?: boolean;
  /** Shown under the avatar when there is no picture. */
  placeholder?: string;
  micMuted?: boolean;
  cameraOff?: boolean;
  /** This tile shows a shared screen. */
  screenShare?: boolean;
  /** Mirror the picture (self-view of a camera; never for a shared screen). */
  mirror?: boolean;
  sinkId?: string;
}

export function VideoTile({
  name,
  isLocal = false,
  stream = null,
  showVideo = false,
  placeholder,
  micMuted,
  cameraOff,
  screenShare = false,
  mirror,
  sinkId,
}: VideoTileProps) {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  const label = isLocal ? `${name} (you)` : name;
  return (
    <figure className="tile" aria-label={label}>
      {!showVideo ? (
        <div className="tile__body">
          <span className="tile__avatar" aria-hidden="true">
            {initial}
          </span>
          {placeholder ? <p className="tile__placeholder">{placeholder}</p> : null}
        </div>
      ) : null}
      {stream ? (
        // The local stream is always muted so you do not hear yourself. The remote stream
        // stays mounted even without video so its audio keeps playing.
        <StreamVideo
          stream={stream}
          muted={isLocal}
          mirror={mirror ?? (isLocal && !screenShare)}
          hidden={!showVideo}
          contain={screenShare}
          sinkId={isLocal ? undefined : sinkId}
          label={`${label} video`}
        />
      ) : null}
      <figcaption className="tile__label">
        <span className="tile__name">{label}</span>
        {screenShare ? <MonitorUp size={14} aria-label="Sharing screen" /> : null}
        {micMuted ? <MicOff size={14} aria-label="Microphone muted" /> : null}
        {cameraOff ? <VideoOff size={14} aria-label="Camera off" /> : null}
      </figcaption>
    </figure>
  );
}
