import { useCallback, useEffect, useRef, useState } from 'react';
import { startAudioCapture } from './audioCapture';
import { createWhisperEngine, getWhisperConfig } from './transcriptionEngine';
import { createDefaultStore, formatTranscript, type TranscriptStore } from './transcriptStore';
import type { TranscriptionState } from './transcription.types';
import { TranscriptionSession } from './transcriptionSession';

const INITIAL: TranscriptionState = {
  status: 'idle',
  progress: null,
  failure: null,
  busy: false,
  segments: [],
  dropped: 0,
};

let sharedStore: { store: TranscriptStore; persistent: boolean } | null = null;
function getStore() {
  sharedStore ??= createDefaultStore();
  return sharedStore;
}

/** Deletes every saved transcript on this device (used by Settings). */
export async function deleteAllTranscripts(): Promise<boolean> {
  try {
    await getStore().store.clearAll();
    return true;
  } catch (error) {
    console.warn('Could not delete transcripts', error);
    return false;
  }
}

/**
 * React binding for local transcription of your own microphone. Nothing starts until `start` is
 * called from a user action, and everything stops when the meeting page closes.
 */
export function useTranscription(meetingId: string, localStream: MediaStream | null) {
  const [state, setState] = useState<TranscriptionState>(INITIAL);
  const sessionRef = useRef<TranscriptionSession | null>(null);
  const streamRef = useRef<MediaStream | null>(localStream);
  const persistent = getStore().persistent;

  useEffect(() => {
    const env = import.meta.env as { VITE_TRANSCRIPTION_MODEL?: string; VITE_TRANSCRIPTION_MODEL_HOST?: string };
    const session = new TranscriptionSession(meetingId, {
      createEngine: () => createWhisperEngine(getWhisperConfig(env)),
      startCapture: (stream, onSamples) => startAudioCapture(stream, onSamples),
      store: getStore().store,
    });
    sessionRef.current = session;
    const unsubscribe = session.subscribe(setState);
    void session.loadHistory();
    return () => {
      unsubscribe();
      session.dispose();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [meetingId]);

  // Follow microphone changes (new device, reconnect) while listening.
  useEffect(() => {
    streamRef.current = localStream;
    void sessionRef.current?.setStream(localStream);
  }, [localStream]);

  const start = useCallback(() => void sessionRef.current?.start(streamRef.current), []);
  const pause = useCallback(() => sessionRef.current?.pause(), []);
  const resume = useCallback(() => void sessionRef.current?.resume(), []);
  const stop = useCallback(() => sessionRef.current?.stop(), []);
  const clear = useCallback(() => void sessionRef.current?.clear(), []);
  const exportText = useCallback(() => formatTranscript(sessionRef.current?.getState().segments ?? []), []);

  return { state, persistent, start, pause, resume, stop, clear, exportText };
}
