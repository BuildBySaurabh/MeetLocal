import { Download, Pause, Play, Square, Trash2 } from 'lucide-react';
import type { TranscriptionState } from '../../features/transcription/transcription.types';
import { LevelMeter } from '../meeting/LevelMeter';
import { TranscriptLine } from './TranscriptLine';

interface TranscriptPanelProps {
  state: TranscriptionState;
  persistent: boolean;
  hasMic: boolean;
  micEnabled: boolean;
  modelName: string;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onClear: () => void;
  onExport: () => void;
}

export function TranscriptPanel(props: TranscriptPanelProps) {
  const { state, persistent, hasMic } = props;
  const active = state.status === 'listening' || state.status === 'paused' || state.status === 'loading-model';
  const percent = typeof state.progress?.fraction === 'number' ? Math.round(state.progress.fraction * 100) : null;

  return (
    <div className="transcript">
      {state.status === 'idle' ? (
        <div className="notice" role="note">
          <div>
            <p>
              <strong>Transcription is off.</strong> When you turn it on, your own microphone is converted to text on
              this device by a speech model that runs in your browser. Audio and text are not sent to MeetLocal or any
              cloud service. Other participants&apos; speech is not transcribed.
            </p>
            <p>
              The first time, the browser downloads the model ({props.modelName}, roughly 40 MB) from its host and keeps
              it for later. Accuracy depends on the model, your microphone, accents, noise and your computer.
            </p>
            <p>
              Lines are saved in this browser only and can be exported or deleted here or in Settings.
              {persistent ? '' : ' Saving is unavailable in this browser, so lines last only until you close the page.'}
            </p>
          </div>
        </div>
      ) : null}

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
          Loading the speech model{percent !== null ? `… ${percent}%` : '…'}
        </p>
      ) : null}
      {state.status === 'listening' ? (
        <p role="status" className="muted">
          {!props.micEnabled
            ? 'Listening, but your microphone is muted.'
            : state.busy
              ? 'Recognising…'
              : 'Listening to your microphone.'}
        </p>
      ) : null}
      {state.status === 'paused' ? (
        <p role="status" className="muted">
          Paused. The microphone is not being processed.
        </p>
      ) : null}
      {state.dropped > 0 ? (
        <p className="muted small" role="status">
          This device could not keep up; {state.dropped} stretch{state.dropped === 1 ? '' : 'es'} of speech skipped.
        </p>
      ) : null}
      {state.status === 'loading-model' && percent !== null ? (
        <LevelMeter level={percent / 100} label="Model download" />
      ) : null}

      <div className="stack-row">
        {!active ? (
          <button type="button" className="btn btn--primary btn--sm" onClick={props.onStart} disabled={!hasMic}>
            <Play size={14} aria-hidden="true" /> {state.status === 'idle' ? 'Start transcription' : 'Try again'}
          </button>
        ) : null}
        {state.status === 'listening' ? (
          <button type="button" className="btn btn--secondary btn--sm" onClick={props.onPause}>
            <Pause size={14} aria-hidden="true" /> Pause
          </button>
        ) : null}
        {state.status === 'paused' ? (
          <button type="button" className="btn btn--secondary btn--sm" onClick={props.onResume}>
            <Play size={14} aria-hidden="true" /> Resume
          </button>
        ) : null}
        {active ? (
          <button type="button" className="btn btn--secondary btn--sm" onClick={props.onStop}>
            <Square size={14} aria-hidden="true" /> Stop
          </button>
        ) : null}
      </div>
      {!hasMic ? <p className="muted small">No microphone is available, so there is nothing to transcribe.</p> : null}

      <ol className="chat__log" aria-label="Transcript">
        {state.segments.length === 0 ? <li className="muted small">No transcript yet.</li> : null}
        {state.segments.map((segment) => (
          <TranscriptLine key={segment.id} segment={segment} />
        ))}
      </ol>

      <div className="stack-row">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={props.onExport}
          disabled={state.segments.length === 0}
        >
          <Download size={14} aria-hidden="true" /> Export .txt
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={props.onClear}
          disabled={state.segments.length === 0}
        >
          <Trash2 size={14} aria-hidden="true" /> Delete transcript
        </button>
      </div>
    </div>
  );
}
