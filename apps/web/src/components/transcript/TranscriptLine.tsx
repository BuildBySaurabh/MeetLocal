import type { TranscriptSegment } from '../../features/transcription/transcription.types';

export function TranscriptLine({ segment }: { segment: TranscriptSegment }) {
  const time = new Date(segment.startedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return (
    <li className="transcript__line">
      <span className="chat__meta">You · {time}</span>
      {segment.text}
    </li>
  );
}
