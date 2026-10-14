import { ArrowRight, Link as LinkIcon, Lock, Plus, ShieldCheck, Sparkles } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { createMeeting, parseMeetingInput } from '../features/rooms/room.service';
import type { MeetingLocationState } from '../features/rooms/room.types';

export function HomePage() {
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleCreate() {
    const { roomId } = createMeeting();
    const state: MeetingLocationState = { intent: 'create' };
    navigate(`/join/${roomId}`, { state });
  }

  function handleJoin(event: FormEvent) {
    event.preventDefault();
    const roomId = parseMeetingInput(input);
    if (!roomId) {
      setError('That does not look like a MeetLocal meeting link or ID. Paste the full link you were sent.');
      return;
    }
    setError(null);
    navigate(`/join/${roomId}`);
  }

  return (
    <main className="page page--home">
      <section className="hero">
        <h1 className="hero__title">
          Connect. Collaborate. <span className="hero__accent">Privately.</span>
        </h1>
        <p className="hero__lead">
          Secure video meetings with local AI. No cloud AI, no recording, just you and your conversations.
        </p>

        <div className="hero__actions">
          <button type="button" className="btn btn--primary btn--lg" onClick={handleCreate}>
            <Plus size={18} aria-hidden="true" />
            New meeting
          </button>

          <form className="join-form" onSubmit={handleJoin} noValidate>
            <label className="sr-only" htmlFor="meeting-input">
              Meeting link or ID
            </label>
            <div className="join-form__field">
              <LinkIcon size={18} aria-hidden="true" />
              <input
                id="meeting-input"
                className="join-form__input"
                type="text"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste a meeting link or ID"
                value={input}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'meeting-input-error' : undefined}
                onChange={(event) => {
                  setInput(event.target.value);
                  if (error) setError(null);
                }}
              />
              <button type="submit" className="join-form__go" aria-label="Join" disabled={input.trim() === ''}>
                <ArrowRight size={18} aria-hidden="true" />
              </button>
            </div>
          </form>
        </div>
        {error ? (
          <p id="meeting-input-error" className="field-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      <section className="features" aria-label="Why MeetLocal">
        <div className="feature">
          <span className="feature__icon" aria-hidden="true">
            <ShieldCheck size={20} />
          </span>
          <h2 className="feature__title">Your data stays local</h2>
          <p className="feature__text">No cloud AI. No recording.</p>
        </div>
        <div className="feature">
          <span className="feature__icon" aria-hidden="true">
            <Lock size={20} />
          </span>
          <h2 className="feature__title">Direct peer-to-peer</h2>
          <p className="feature__text">Media stays between you.</p>
        </div>
        <div className="feature">
          <span className="feature__icon" aria-hidden="true">
            <Sparkles size={20} />
          </span>
          <h2 className="feature__title">AI-powered (optional)</h2>
          <p className="feature__text">Transcription, notes and more.</p>
        </div>
      </section>

      <details className="privacy-details">
        <summary>What stays where</summary>
        <ul className="plain-list">
          <li>
            <strong>Between participants:</strong> audio and video, sent peer-to-peer when a direct connection succeeds.
          </li>
          <li>
            <strong>Through the signaling server:</strong> connection setup data (names, room ID, network candidates),
            plus chat and any transcript lines someone chooses to share. Never audio or video.
          </li>
          <li>
            <strong>On your device only:</strong> speech-to-text, translation, assistant answers and background effects.
          </li>
          <li>
            <strong>Caveat:</strong> finding a connection path uses a STUN server and sometimes a relay, which can see
            network addresses.
          </li>
        </ul>
      </details>
    </main>
  );
}
