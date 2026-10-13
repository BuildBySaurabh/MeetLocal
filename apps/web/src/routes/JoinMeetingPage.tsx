import { AlertTriangle, Camera, Mic } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { CopyLinkButton } from '../components/meeting/CopyLinkButton';
import { StreamVideo } from '../components/meeting/StreamVideo';
import { useMediaPreview } from '../features/media/useMediaPreview';
import { getShareUrl, isValidRoomId } from '../features/rooms/room.service';
import type { MeetingLocationState } from '../features/rooms/room.types';
import { useDisplayName } from '../hooks/useDisplayName';

export function JoinMeetingPage() {
  const { roomId = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { name, setName, isValid, error, commit } = useDisplayName();
  const [touched, setTouched] = useState(false);
  const preview = useMediaPreview();

  const intent = (location.state as MeetingLocationState | null)?.intent ?? 'join';

  const previewState = preview.state;
  const missing = previewState.status === 'ready' ? previewState.missing : [];
  const cameraAvailable = previewState.status === 'ready' && !missing.includes('camera');
  const micAvailable = previewState.status === 'ready' && !missing.includes('microphone');
  const failureBadge =
    previewState.status === 'failed'
      ? previewState.failure.kind === 'permission-denied'
        ? 'Blocked'
        : 'Unavailable'
      : null;
  const cameraBadge =
    previewState.status === 'ready' ? (cameraAvailable ? 'Ready' : 'Not found') : (failureBadge ?? 'Not checked');
  const micBadge =
    previewState.status === 'ready' ? (micAvailable ? 'Ready' : 'Not found') : (failureBadge ?? 'Not checked');

  if (!isValidRoomId(roomId)) {
    return (
      <main className="page page--center">
        <div className="card card--narrow" role="alert">
          <h1 className="card__title">Invalid meeting link</h1>
          <p className="muted">
            This link is not a valid MeetLocal meeting. Check that you copied the whole link, or ask the host to send it
            again.
          </p>
          <Link to="/" className="btn btn--primary">
            Back to home
          </Link>
        </div>
      </main>
    );
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    const saved = commit();
    if (!saved) return;
    const state: MeetingLocationState = { intent };
    navigate(`/meeting/${roomId}`, { state: { ...state, displayName: saved } });
  }

  const showError = touched && !isValid;

  return (
    <main className="page page--join">
      <section className="card join-preview" aria-labelledby="preview-heading">
        <h2 id="preview-heading" className="card__title">
          Check your setup
        </h2>
        <div className="preview-box">
          {preview.state.status === 'ready' && cameraAvailable ? (
            <div className="preview-box__video">
              <StreamVideo stream={preview.state.stream} muted mirror label="Your camera preview" />
            </div>
          ) : (
            <>
              <Camera size={32} aria-hidden="true" />
              <p>
                {preview.state.status === 'requesting'
                  ? 'Waiting for your browser permission…'
                  : preview.state.status === 'ready'
                    ? 'No camera in use.'
                    : 'Your camera and microphone are off.'}
              </p>
            </>
          )}
        </div>

        {preview.state.status === 'failed' ? (
          <div className="notice notice--warn" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <div>
              <p>
                <strong>{preview.state.failure.message}</strong>
              </p>
              <p>{preview.state.failure.recovery}</p>
            </div>
          </div>
        ) : null}

        <ul className="status-list">
          <li>
            <Camera size={16} aria-hidden="true" /> Camera: <span className="badge">{cameraBadge}</span>
          </li>
          <li>
            <Mic size={16} aria-hidden="true" /> Microphone: <span className="badge">{micBadge}</span>
          </li>
        </ul>

        {preview.state.status === 'ready' ? (
          <button type="button" className="btn btn--secondary" onClick={preview.stop}>
            Turn off preview
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => void preview.start()}
            disabled={preview.state.status === 'requesting'}
          >
            {preview.state.status === 'failed' ? 'Try again' : 'Turn on camera and microphone'}
          </button>
        )}
        <p className="muted small">
          Your camera and microphone are only used once you ask. You can also join without them and still see and hear
          others.
        </p>
      </section>

      <section className="card join-panel" aria-labelledby="join-heading">
        <h1 id="join-heading" className="card__title">
          {intent === 'create' ? 'Your meeting is ready' : 'Join meeting'}
        </h1>
        <p className="muted">
          {intent === 'create'
            ? 'Enter your name, then share the link below with the person you want to meet.'
            : 'Enter the name other participants will see.'}
        </p>

        {intent === 'create' ? (
          <div className="link-box">
            <code className="link-box__url">{getShareUrl(roomId)}</code>
            <CopyLinkButton url={getShareUrl(roomId)} />
          </div>
        ) : null}

        <form onSubmit={handleSubmit} noValidate className="form">
          <label className="label" htmlFor="display-name">
            Your name
          </label>
          <input
            id="display-name"
            className="input"
            type="text"
            autoComplete="nickname"
            maxLength={40}
            value={name}
            aria-invalid={showError ? true : undefined}
            aria-describedby={showError ? 'display-name-error' : undefined}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => setTouched(true)}
          />
          {showError ? (
            <p id="display-name-error" className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="btn btn--primary btn--lg">
            {intent === 'create' ? 'Start meeting' : 'Join meeting'}
          </button>
        </form>
      </section>
    </main>
  );
}
