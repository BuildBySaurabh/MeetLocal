import { useCallback, useEffect, useRef, useState } from 'react';
import { createMediaPipeEngine, getFaceModelConfig } from './faceLandmarker';
import type { CameraCheckState } from './gaze.types';
import { CameraCheckSession, createVideoFrameSource } from './eyeTrackingSession';

const INITIAL: CameraCheckState = {
  status: 'idle',
  failure: null,
  facePresent: false,
  metrics: null,
  calibrated: false,
};

/** React binding for the optional camera check. Off until the user turns it on; stops when the page closes. */
export function useEyeTracking(localStream: MediaStream | null, cameraEnabled: boolean) {
  const [state, setState] = useState<CameraCheckState>(INITIAL);
  const sessionRef = useRef<CameraCheckSession | null>(null);
  const streamRef = useRef(localStream);
  const cameraRef = useRef(cameraEnabled);
  streamRef.current = localStream;
  cameraRef.current = cameraEnabled;

  useEffect(() => {
    const config = getFaceModelConfig(import.meta.env as { VITE_FACE_MODEL_URL?: string });
    const session = new CameraCheckSession({
      createEngine: () => createMediaPipeEngine(config),
      createFrameSource: createVideoFrameSource,
    });
    sessionRef.current = session;
    const unsubscribe = session.subscribe(setState);
    return () => {
      unsubscribe();
      session.dispose();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, []);

  useEffect(() => {
    sessionRef.current?.setCameraEnabled(cameraEnabled);
  }, [cameraEnabled]);

  // If the camera stream is replaced (device switch), restart analysis on the new one.
  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    const status = session.getState().status;
    if (status === 'running' || status === 'camera-off') {
      session.stop();
      void session.start(localStream, cameraRef.current);
    }
  }, [localStream]);

  const start = useCallback(() => void sessionRef.current?.start(streamRef.current, cameraRef.current), []);
  const stop = useCallback(() => sessionRef.current?.stop(), []);
  const calibrate = useCallback(() => sessionRef.current?.calibrate() ?? false, []);
  return { state, start, stop, calibrate };
}
