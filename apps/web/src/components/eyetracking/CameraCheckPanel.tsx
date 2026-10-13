import { Crosshair, Play, Square } from 'lucide-react';
import { cameraSuggestions, eyeDirection, headDirection } from '../../features/eye-tracking/gazeEstimator';
import type { CameraCheckState } from '../../features/eye-tracking/gaze.types';

interface CameraCheckPanelProps {
  state: CameraCheckState;
  hasCamera: boolean;
  onStart: () => void;
  onStop: () => void;
  onCalibrate: () => boolean;
}

const HEAD_LABEL = {
  facing: 'Facing the camera',
  'turned-left': 'Turned toward your left',
  'turned-right': 'Turned toward your right',
} as const;

const EYE_LABEL = {
  center: 'Roughly centred',
  left: 'Toward your left',
  right: 'Toward your right',
  up: 'Upward',
  down: 'Downward',
  unknown: 'Unknown (eyes may be closed)',
} as const;

export function CameraCheckPanel({ state, hasCamera, onStart, onStop, onCalibrate }: CameraCheckPanelProps) {
  const active = state.status === 'running' || state.status === 'camera-off' || state.status === 'loading-model';
  const m = state.metrics;
  const tips = cameraSuggestions(m);

  return (
    <div className="camera-check">
      <div className="notice" role="note">
        <div>
          <p>
            <strong>Approximate camera feedback, for you only.</strong> A face-landmark model on this device estimates
            whether your face is visible, roughly where your head and eyes point, and whether you fit the frame.
          </p>
          <p>
            It does <strong>not</strong> measure attention, honesty, effort or ability, and looking away means nothing
            about any of those. It does not identify anyone or read emotions. Nothing is recorded, saved or sent; other
            participants never see it.
          </p>
        </div>
      </div>

      {state.failure ? (
        <div className="notice notice--warn" role="alert">
          <div>
            <p>
              <strong>{state.failure.message}</strong>
            </p>
            <p>{state.failure.recovery}</p>
          </div>
        </div>
      ) : null}

      {state.status === 'loading-model' ? (
        <p role="status" className="muted">
          Starting the face model…
        </p>
      ) : null}
      {state.status === 'camera-off' ? (
        <p role="status" className="muted">
          Your camera is off, so there is nothing to analyse.
        </p>
      ) : null}

      <div className="stack-row">
        {!active ? (
          <button type="button" className="btn btn--primary btn--sm" onClick={onStart} disabled={!hasCamera}>
            <Play size={14} aria-hidden="true" /> {state.status === 'idle' ? 'Turn on camera check' : 'Try again'}
          </button>
        ) : (
          <button type="button" className="btn btn--secondary btn--sm" onClick={onStop}>
            <Square size={14} aria-hidden="true" /> Turn off
          </button>
        )}
        {state.status === 'running' ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={!m || m.eyeX === null}
            onClick={() => void onCalibrate()}
          >
            <Crosshair size={14} aria-hidden="true" /> {state.calibrated ? 'Recalibrate' : 'Calibrate'}
          </button>
        ) : null}
      </div>
      {!hasCamera ? <p className="muted small">No camera is available.</p> : null}
      {state.status === 'running' ? (
        <p className="muted small">
          {state.calibrated
            ? 'Calibrated to your current pose.'
            : 'Not calibrated. Look at the camera and press Calibrate for more reliable up/down and eye readings.'}
        </p>
      ) : null}

      {state.status === 'running' ? (
        <dl className="camera-check__results" aria-label="Approximate results">
          <dt>Face</dt>
          <dd>{m ? 'Detected' : state.facePresent ? 'Not detected right now' : 'Not detected yet'}</dd>
          {m ? (
            <>
              <dt>Head turn (approx.)</dt>
              <dd>
                {HEAD_LABEL[headDirection(m)]} (about {Math.round(Math.abs(m.yaw) / 5) * 5}°)
              </dd>
              <dt>Head up/down tilt (approx.)</dt>
              <dd>about {Math.round(Math.abs(m.pitch) / 5) * 5}° from neutral</dd>
              <dt>Eye direction (very approx.)</dt>
              <dd>{EYE_LABEL[eyeDirection(m)]}</dd>
              <dt>In frame</dt>
              <dd>{m.outsideFrame ? 'Partly outside the frame' : 'Fully inside the frame'}</dd>
            </>
          ) : null}
        </dl>
      ) : null}

      {tips.length > 0 ? (
        <div>
          <h3 className="side-panel__title">Camera tips</h3>
          <ul className="plain-list">
            {tips.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
