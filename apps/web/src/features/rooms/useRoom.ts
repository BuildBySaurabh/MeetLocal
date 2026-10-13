import { generateParticipantId } from '@meetlocal/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { requestLocalMedia, requestScreenShare, requestTrack } from '../media/media.service';
import { loadDevicePreferences } from '../../services/preferences';
import { SignalingClient, getSignalingUrl } from '../signaling/signalingClient';
import { getIceServers, type EnvLike } from '../webrtc/iceManager';
import { BackgroundProcessor } from '../background/backgroundProcessor';
import { createMediaPipeSegmenter, getSegmenterConfig } from '../background/personSegmenter';
import type { BackgroundMode } from '../background/background.types';
import { PeerSession } from '../webrtc/peerConnection';
import { MeetingSession, type MeetingDeps, type MeetingOptions, type MeetingState } from './meetingSession';

function createDefaultDeps(): MeetingDeps {
  const env = import.meta.env as EnvLike;
  return {
    requestMedia: () => requestLocalMedia(undefined, loadDevicePreferences()),
    requestScreenShare: () => requestScreenShare(),
    requestTrack: (kind, deviceId) => requestTrack(kind, deviceId),
    createStream: (tracks) => new MediaStream(tracks),
    createSignaling: (handlers) => new SignalingClient(getSignalingUrl(env, window.location), handlers),
    createPeer: (options, callbacks) => new PeerSession(options, callbacks),
    createBackgroundProcessor: () =>
      new BackgroundProcessor(() =>
        createMediaPipeSegmenter(getSegmenterConfig(import.meta.env as { VITE_SEGMENTER_MODEL_URL?: string })),
      ),
    iceServers: getIceServers(env),
    generateParticipantId,
  };
}

/** React binding for a MeetingSession. Starting and cleanup follow the component lifecycle. */
export function useMeetingSession(options: MeetingOptions) {
  const { roomId, displayName, intent } = options;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<MeetingState | null>(null);
  const sessionRef = useRef<MeetingSession | null>(null);

  useEffect(() => {
    const session = new MeetingSession({ roomId, displayName, intent }, createDefaultDeps());
    sessionRef.current = session;
    const unsubscribe = session.subscribe(setState);
    void session.start();
    // Reloading or closing the tab: tell the server and release the camera right away instead of
    // waiting for the socket timeout. (The browser may not run async work during unload.)
    const handlePageHide = () => session.leave();
    // If the browser restores this page from its back/forward cache, the session was already ended
    // by pagehide, so start a fresh one.
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setAttempt((n) => n + 1);
    };
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
      unsubscribe();
      session.leave();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [roomId, displayName, intent, attempt]);

  const toggleMic = useCallback(() => sessionRef.current?.toggleMic(), []);
  const toggleCamera = useCallback(() => sessionRef.current?.toggleCamera(), []);
  const leave = useCallback(() => sessionRef.current?.leave(), []);
  const startScreenShare = useCallback(() => void sessionRef.current?.startScreenShare(), []);
  const stopScreenShare = useCallback(() => void sessionRef.current?.stopScreenShare(), []);
  const selectCamera = useCallback((id: string) => void sessionRef.current?.selectCamera(id), []);
  const selectMicrophone = useCallback((id: string) => void sessionRef.current?.selectMicrophone(id), []);
  const sendChat = useCallback((text: string) => sessionRef.current?.sendChat(text) ?? false, []);
  const dismissNotice = useCallback(() => sessionRef.current?.dismissNotice(), []);
  const setTranscriptSharing = useCallback((enabled: boolean) => sessionRef.current?.setTranscriptSharing(enabled), []);
  const recordOwnSpeech = useCallback((text: string) => sessionRef.current?.recordOwnSpeech(text), []);
  const setBackground = useCallback((mode: BackgroundMode) => sessionRef.current?.setBackground(mode), []);
  const clearNotes = useCallback(() => sessionRef.current?.clearNotes(), []);
  /** Tears the session down and starts a fresh one (new media request, new connection). */
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return {
    state,
    toggleMic,
    toggleCamera,
    leave,
    retry,
    startScreenShare,
    stopScreenShare,
    selectCamera,
    selectMicrophone,
    sendChat,
    dismissNotice,
    setTranscriptSharing,
    recordOwnSpeech,
    clearNotes,
    setBackground,
  };
}
