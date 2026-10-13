import { ArrowRight, Lock, Plus, ShieldCheck } from 'lucide-react';
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
    <main className="page">
      <section className="hero">
        <p className="eyebrow">
          <Lock size={14} aria-hidden="true" /> Private by design
        </p>
        <h1 className="hero__title">Video meetings that keep your conversations on your device.</h1>
        <p className="hero__lead">
          Start a meeting, share the link, and talk. Media goes directly between participants when the network allows
          it, and optional AI features run locally, never in a cloud AI service.
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
            <input
              id="meeting-input"
              className="input"
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
            <button type="submit" className="btn btn--secondary btn--lg" disabled={input.trim() === ''}>
              Join
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          </form>
          {error ? (
            <p id="meeting-input-error" className="field-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </section>

      <section className="card privacy-card" aria-labelledby="privacy-heading">
        <h2 id="privacy-heading" className="card__title">
          <ShieldCheck size={18} aria-hidden="true" /> What stays where
        </h2>
        <ul className="plain-list">
          <li>
            <strong>Between participants:</strong> audio and video, sent peer-to-peer when a direct connection succeeds.
          </li>
          <li>
            <strong>Through the signaling server:</strong> only connection setup data (names, room ID, network
            candidates). No media and no transcripts.
          </li>
          <li>
            <strong>On your device only:</strong> transcripts, notes and AI conversations, if you enable those features
            later.
          </li>
          <li>
            <strong>Caveat:</strong> finding a connection path uses a STUN server and sometimes a relay, which can see
            network addresses. See the privacy notes for details.
          </li>
        </ul>
      </section>
    </main>
  );
}
