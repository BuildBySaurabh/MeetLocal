import { useState, type FormEvent } from 'react';
import { useDisplayName } from '../hooks/useDisplayName';
import { deleteAllAssistantHistory } from '../features/assistant/useAssistant';
import { deleteAllTranscripts } from '../features/transcription/useTranscription';
import { clearPreferences } from '../services/preferences';

type Notice = { kind: 'ok' | 'error'; text: string } | null;

export function SettingsPage() {
  const { name, setName, error, isValid, commit } = useDisplayName();
  const [notice, setNotice] = useState<Notice>(null);
  const [touched, setTouched] = useState(false);

  function handleSave(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (commit()) setNotice({ kind: 'ok', text: 'Saved on this device.' });
    else setNotice(null);
  }

  function handleClear() {
    const confirmed = window.confirm('Delete all MeetLocal settings stored in this browser?');
    if (!confirmed) return;
    if (clearPreferences()) {
      setName('');
      setTouched(false);
      setNotice({
        kind: 'ok',
        text: 'Saved settings deleted from this browser.',
      });
    } else {
      setNotice({
        kind: 'error',
        text: 'Could not delete settings. Your browser may be blocking storage access.',
      });
    }
  }

  async function handleDeleteTranscripts() {
    const confirmed = window.confirm(
      'Delete all transcripts and assistant conversations saved in this browser? This cannot be undone.',
    );
    if (!confirmed) return;
    const ok = (await deleteAllTranscripts()) && (await deleteAllAssistantHistory());
    setNotice(
      ok
        ? { kind: 'ok', text: 'Saved transcripts and assistant history deleted from this browser.' }
        : { kind: 'error', text: 'Could not delete transcripts. Your browser may be blocking storage access.' },
    );
  }

  const showError = touched && !isValid;

  return (
    <main className="page page--narrow">
      <h1 className="page__title">Settings</h1>

      <section className="card" aria-labelledby="profile-heading">
        <h2 id="profile-heading" className="card__title">
          Profile
        </h2>
        <form onSubmit={handleSave} noValidate className="form">
          <label className="label" htmlFor="settings-name">
            Default display name
          </label>
          <input
            id="settings-name"
            className="input"
            type="text"
            maxLength={40}
            value={name}
            aria-invalid={showError ? true : undefined}
            aria-describedby={showError ? 'settings-name-error' : undefined}
            onChange={(event) => setName(event.target.value)}
          />
          {showError ? (
            <p id="settings-name-error" className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="stack-row">
            <button type="submit" className="btn btn--primary">
              Save
            </button>
            {notice ? (
              <span className={notice.kind === 'ok' ? 'muted' : 'field-error'} role="status">
                {notice.text}
              </span>
            ) : null}
          </div>
        </form>
      </section>

      <section className="card" aria-labelledby="devices-heading">
        <h2 id="devices-heading" className="card__title">
          Camera, microphone and speaker
        </h2>
        <p className="muted">
          Choose your devices during a meeting with the Devices button. MeetLocal remembers the choice on this device
          and uses it next time. Browsers show device names only after camera or microphone access has been allowed.
        </p>
      </section>

      <section className="card" aria-labelledby="planned-heading">
        <h2 id="planned-heading" className="card__title">
          Coming in later versions
        </h2>
        <ul className="plain-list">
          <li>Local AI model configuration</li>
          <li>Transcription language and model choice (currently set by environment variables)</li>
        </ul>
        <p className="muted small">None of these are available yet, so no controls are shown for them.</p>
      </section>

      <section className="card" aria-labelledby="data-heading">
        <h2 id="data-heading" className="card__title">
          Local data
        </h2>
        <p className="muted">
          MeetLocal currently stores your default display name and your chosen camera, microphone and speaker IDs, and,
          if you use transcription, transcript lines, in this browser. Browser storage is not encrypted and may be
          readable by anyone using this browser profile.
        </p>
        <button type="button" className="btn btn--danger" onClick={handleClear}>
          Delete saved settings
        </button>
        <button type="button" className="btn btn--danger" onClick={() => void handleDeleteTranscripts()}>
          Delete saved transcripts and assistant history
        </button>
      </section>
    </main>
  );
}
