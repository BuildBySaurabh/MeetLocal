import { useCallback, useEffect, useRef, useState } from 'react';
import type { MediaFailure, MissingDevice } from './media.types';
import { requestLocalMedia, stopStream } from './media.service';

export type PreviewState =
  | { status: 'idle' }
  | { status: 'requesting' }
  | { status: 'ready'; stream: MediaStream; missing: MissingDevice[] }
  | { status: 'failed'; failure: MediaFailure };

/**
 * Local camera/microphone preview for the join page. Media is opened only when `start` is
 * called (a user action) and every track is released on `stop` or unmount.
 */
export function useMediaPreview() {
  const [state, setState] = useState<PreviewState>({ status: 'idle' });
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    stopStream(streamRef.current);
    streamRef.current = null;
    setState({ status: 'idle' });
  }, []);

  const start = useCallback(async () => {
    setState({ status: 'requesting' });
    const result = await requestLocalMedia();
    if (!mountedRef.current) {
      // The user left the page while the permission prompt was open: release immediately.
      if (result.ok) stopStream(result.stream);
      return;
    }
    stopStream(streamRef.current);
    if (result.ok) {
      streamRef.current = result.stream;
      setState({ status: 'ready', stream: result.stream, missing: result.missing });
    } else {
      streamRef.current = null;
      setState({ status: 'failed', failure: result.failure });
    }
  }, []);

  return { state, start, stop };
}
