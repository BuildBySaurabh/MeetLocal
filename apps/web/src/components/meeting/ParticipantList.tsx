import { MicOff, Mic, MonitorUp, Video, VideoOff } from 'lucide-react';

export interface ParticipantRow {
  id: string;
  name: string;
  isYou: boolean;
  /** null = unknown (the other side has not said yet) */
  micEnabled: boolean | null;
  cameraEnabled: boolean | null;
  screenSharing: boolean;
}

export function ParticipantList({ participants }: { participants: ParticipantRow[] }) {
  return (
    <ul className="participants" aria-label="Participants">
      {participants.map((p) => (
        <li key={p.id} className="participants__item">
          <span>
            {p.name}
            {p.isYou ? ' (you)' : ''}
          </span>
          <span className="participants__icons">
            {p.screenSharing ? <MonitorUp size={16} aria-label="Sharing screen" /> : null}
            {p.micEnabled === false ? (
              <MicOff size={16} className="is-off" aria-label="Microphone off" />
            ) : p.micEnabled ? (
              <Mic size={16} aria-label="Microphone on" />
            ) : null}
            {p.cameraEnabled === false ? (
              <VideoOff size={16} className="is-off" aria-label="Camera off" />
            ) : p.cameraEnabled ? (
              <Video size={16} aria-label="Camera on" />
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
