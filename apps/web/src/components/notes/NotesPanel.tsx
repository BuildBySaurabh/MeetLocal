import { Download, Trash2 } from 'lucide-react';
import type { NoteEntry } from '../../features/rooms/meetingSession';
import type { TranscriptionState } from '../../features/transcription/transcription.types';
import { LANGUAGES } from '../../features/translation/languages';
import type { TranslatorState } from '../../features/translation/noteTranslator';
import { defaultTime } from '../../features/notes/notesFormat';

interface NotesPanelProps {
  notes: readonly NoteEntry[];
  /** Display names of the other people currently sharing their transcript lines. */
  sharerNames: string[];
  sharing: boolean;
  transcription: TranscriptionState;
  hasMic: boolean;
  connected: boolean;
  translation: TranslatorState;
  onStartTranscription: () => void;
  onStopTranscription: () => void;
  onToggleSharing: (enabled: boolean) => void;
  onSetLanguage: (code: string) => void;
  onDownload: (format: 'txt' | 'md') => void;
  onClear: () => void;
}

export function NotesPanel(props: NotesPanelProps) {
  const { notes, transcription, translation } = props;
  const listening = transcription.status === 'listening' || transcription.status === 'paused';
  const loading = transcription.status === 'loading-model';
  const percent =
    typeof transcription.progress?.fraction === 'number' ? Math.round(transcription.progress.fraction * 100) : null;

  return (
    <div className="notes">
      <section aria-labelledby="notes-you">
        <h3 id="notes-you" className="notes__heading">
          Your voice
        </h3>
        <p className="muted small">
          Your own microphone is turned into text on this device. Audio never leaves it. Each person does this for
          themselves, and anyone can choose to share their lines so everyone gets one set of notes with names.
        </p>
        {listening || loading ? (
          <button type="button" className="btn btn--secondary btn--sm" onClick={props.onStopTranscription}>
            Stop transcribing
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={props.onStartTranscription}
            disabled={!props.hasMic}
          >
            Start transcribing my voice
          </button>
        )}
        {!props.hasMic ? <p className="muted small">No microphone is available.</p> : null}
        {loading ? (
          <p role="status" className="muted small">
            Loading the speech model{percent !== null ? `… ${percent}%` : '…'}
          </p>
        ) : null}
        {transcription.failure ? (
          <p role="alert" className="notes__problem">
            {transcription.failure.message} {transcription.failure.recovery}
          </p>
        ) : null}

        <label className="notes__switch">
          <input
            type="checkbox"
            checked={props.sharing}
            disabled={!listening || !props.connected}
            onChange={(event) => props.onToggleSharing(event.target.checked)}
          />
          <span>Share my lines with everyone in this meeting</span>
        </label>
        <p className="muted small">
          {props.sharing
            ? 'Others can see that you are sharing. Your text passes through the meeting server in memory only and is not stored.'
            : listening
              ? 'Off: your lines appear only in your own notes.'
              : 'Start transcribing first, then you can choose to share.'}
        </p>
        <p className="muted small" role="status">
          {props.sharerNames.length
            ? `Sharing their lines: ${props.sharerNames.join(', ')}.`
            : 'Nobody else is sharing their lines yet.'}
        </p>
      </section>

      <section aria-labelledby="notes-translate">
        <h3 id="notes-translate" className="notes__heading">
          Translate notes
        </h3>
        <div className="form">
          <label className="label" htmlFor="notes-language">
            Show translation in
          </label>
          <select
            id="notes-language"
            className="input"
            value={translation.target?.code ?? ''}
            onChange={(event) => props.onSetLanguage(event.target.value)}
          >
            <option value="">Off</option>
            {LANGUAGES.map((language) => (
              <option key={language.code} value={language.code}>
                {language.name} ({language.native})
              </option>
            ))}
          </select>
        </div>
        <p className="muted small">
          Uses a model on this computer (Ollama). Nothing is sent to a cloud service. Quality depends on the model.
        </p>
        {translation.status === 'checking' ? (
          <p role="status" className="muted small">
            Checking the local model…
          </p>
        ) : null}
        {translation.message ? (
          <p role="alert" className="notes__problem">
            {translation.message}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="notes-log">
        <h3 id="notes-log" className="notes__heading">
          Meeting notes
        </h3>
        <ol className="notes__log" aria-label="Meeting notes" aria-live="polite">
          {notes.length === 0 ? <li className="muted small">No notes yet.</li> : null}
          {notes.map((note) => (
            <li key={note.id} className={`notes__line${note.own ? ' notes__line--own' : ''}`}>
              <span className="chat__meta">
                {note.own ? `${note.speakerName} (you)` : note.speakerName} · {defaultTime(note.at)}
              </span>
              {note.text}
              {translation.translations.get(note.id) ? (
                <span className="notes__translation">{translation.translations.get(note.id)}</span>
              ) : null}
            </li>
          ))}
        </ol>
        <div className="stack-row">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={notes.length === 0}
            onClick={() => props.onDownload('txt')}
          >
            <Download size={14} aria-hidden="true" /> Download .txt
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={notes.length === 0}
            onClick={() => props.onDownload('md')}
          >
            <Download size={14} aria-hidden="true" /> Download .md
          </button>
          <button type="button" className="btn btn--ghost btn--sm" disabled={notes.length === 0} onClick={props.onClear}>
            <Trash2 size={14} aria-hidden="true" /> Clear
          </button>
        </div>
        <p className="muted small">
          Notes live only in this tab. They are gone when you leave, so download them first.
        </p>
      </section>
    </div>
  );
}
