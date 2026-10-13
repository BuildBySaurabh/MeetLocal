import { useEffect, useRef } from 'react';
import type { TranscriptionState } from '../transcription/transcription.types';

/**
 * Feeds your own newly recognised lines into the meeting notes.
 *
 * Only lines that ended after transcription was started in this visit are used; lines restored from
 * saved history are never re-added (or re-shared). Each line is recorded once.
 */
export function useOwnSpeechRecorder(
  transcription: Pick<TranscriptionState, 'status' | 'segments'>,
  record: (text: string) => void,
  now: () => number = Date.now,
): void {
  const sinceRef = useRef<number | null>(null);
  const recorded = useRef(new Set<string>());
  useEffect(() => {
    const { status, segments } = transcription;
    if (status === 'listening' || status === 'paused' || status === 'loading-model') {
      sinceRef.current ??= now();
    } else {
      sinceRef.current = null;
    }
    const since = sinceRef.current;
    if (since === null) return;
    for (const segment of segments) {
      if (recorded.current.has(segment.id) || segment.endedAt < since) continue;
      recorded.current.add(segment.id);
      record(segment.text);
    }
  }, [transcription, record, now]);
}
