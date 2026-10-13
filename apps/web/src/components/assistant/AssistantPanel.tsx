import { RefreshCw, Square, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { AssistantState, AssistantTask } from '../../features/assistant/assistant.types';
import { TASK_LABEL } from '../../features/assistant/promptBuilder';
import type { TranscriptSegment } from '../../features/transcription/transcription.types';

interface AssistantPanelProps {
  state: AssistantState;
  segments: TranscriptSegment[];
  onRun: (task: AssistantTask, segments: TranscriptSegment[], question?: string) => void;
  onCancel: () => void;
  onRefresh: () => void;
  onSetModel: (model: string) => void;
  onClearHistory: () => void;
}

const TASKS: AssistantTask[] = ['summary', 'notes', 'actions', 'questions', 'explain', 'practice', 'study'];

export function AssistantPanel(props: AssistantPanelProps) {
  const { state, segments } = props;
  const [selected, setSelected] = useState<Set<string>>(new Set(segments.map((s) => s.id)));
  const [question, setQuestion] = useState('');
  const [knownIds, setKnownIds] = useState<Set<string>>(new Set(segments.map((s) => s.id)));

  // New lines that arrive while the panel is open start unselected: the user chooses what is shared.
  useEffect(() => {
    const fresh = segments.filter((s) => !knownIds.has(s.id));
    if (fresh.length > 0) setKnownIds(new Set([...knownIds, ...fresh.map((s) => s.id)]));
  }, [segments, knownIds]);

  const chosen = segments.filter((s) => selected.has(s.id));
  const ready = state.status === 'ready' && !state.generating;

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function handleAsk(event: FormEvent) {
    event.preventDefault();
    props.onRun('ask', chosen, question);
    setQuestion('');
  }

  return (
    <div className="assistant">
      <p className="muted small">
        Optional. Uses a language model running on this computer (Ollama). Nothing is sent to a cloud AI service.
        Answers can be wrong; check them against the transcript.
      </p>

      {state.status === 'checking' ? (
        <p role="status" className="muted">
          Looking for the local model…
        </p>
      ) : null}

      {state.status === 'blocked-endpoint' ? (
        <div className="notice notice--warn" role="alert">
          <div>
            <p>
              <strong>The model address is not on this computer, so it is blocked.</strong>
            </p>
            <p>
              Only localhost addresses are allowed (currently {state.endpoint || 'not set'}). Change VITE_OLLAMA_URL.
            </p>
          </div>
        </div>
      ) : null}

      {state.status === 'unavailable' ? (
        <div className="notice notice--warn" role="alert">
          <div>
            <p>
              <strong>The local model is not available.</strong> Meetings keep working without it.
            </p>
            <p>
              Install and start Ollama (ollama.com), run <code>ollama pull llama3.2</code>, and allow this page with{' '}
              <code>OLLAMA_ORIGINS={window.location.origin}</code>. Looked at {state.endpoint}.
            </p>
            <button type="button" className="btn btn--secondary btn--sm" onClick={props.onRefresh}>
              <RefreshCw size={14} aria-hidden="true" /> Check again
            </button>
          </div>
        </div>
      ) : null}

      {state.status === 'no-model' ? (
        <div className="notice notice--warn" role="alert">
          <div>
            <p>
              <strong>Ollama is running but has no models installed.</strong>
            </p>
            <p>
              Install one, for example <code>ollama pull llama3.2</code>, then check again.
            </p>
            <button type="button" className="btn btn--secondary btn--sm" onClick={props.onRefresh}>
              <RefreshCw size={14} aria-hidden="true" /> Check again
            </button>
          </div>
        </div>
      ) : null}

      {state.status === 'model-missing' ? (
        <div className="notice notice--warn" role="alert">
          <div>
            <p>
              <strong>The configured model “{state.model}” is not installed.</strong>
            </p>
            <p>
              Install it with <code>ollama pull {state.model}</code>, or choose an installed model below.
            </p>
          </div>
        </div>
      ) : null}

      {state.models.length > 0 ? (
        <div className="form">
          <label className="label" htmlFor="assistant-model">
            Model
          </label>
          <select
            id="assistant-model"
            className="input"
            value={state.status === 'ready' ? (state.model ?? '') : ''}
            onChange={(event) => props.onSetModel(event.target.value)}
          >
            {state.status !== 'ready' ? <option value="">Choose a model</option> : null}
            {state.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <fieldset className="assistant__sources">
        <legend className="label">Transcript lines to share with the model</legend>
        {segments.length === 0 ? (
          <p className="muted small">
            There is no transcript yet. Turn on transcription in the Transcript panel, then come back.
          </p>
        ) : (
          <>
            <div className="stack-row">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setSelected(new Set(segments.map((s) => s.id)))}
              >
                Select all
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSelected(new Set())}>
                Select none
              </button>
              <span className="muted small">
                {chosen.length} of {segments.length} selected
              </span>
            </div>
            <ul className="assistant__lines">
              {segments.map((s) => (
                <li key={s.id}>
                  <label>
                    <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} /> {s.text}
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
      </fieldset>

      <div className="assistant__tasks" role="group" aria-label="Assistant tasks">
        {TASKS.map((task) => (
          <button
            key={task}
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={!ready || chosen.length === 0}
            onClick={() => props.onRun(task, chosen)}
          >
            {TASK_LABEL[task]}
          </button>
        ))}
      </div>
      <form className="chat__form" onSubmit={handleAsk}>
        <input
          className="input"
          aria-label="Question about the selected lines"
          placeholder="Ask about the selected lines"
          value={question}
          disabled={!ready || chosen.length === 0}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <button
          type="submit"
          className="btn btn--primary btn--sm"
          disabled={!ready || chosen.length === 0 || !question.trim()}
        >
          Ask
        </button>
      </form>

      {state.generating ? (
        <div className="stack-row">
          <span role="status" className="muted">
            Thinking on this device…
          </span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={props.onCancel}>
            <Square size={14} aria-hidden="true" /> Stop
          </button>
        </div>
      ) : null}
      {state.error ? (
        <p className="field-error" role="alert">
          {state.error}
        </p>
      ) : null}

      <ol className="assistant__turns" aria-label="Assistant history">
        {state.turns.map((turn) => (
          <li key={turn.id} className="assistant__turn">
            <span className="chat__meta">You asked: {turn.prompt}</span>
            <span className="chat__meta">
              Generated by {turn.model} on this device from {turn.sourceCount} selected line
              {turn.sourceCount === 1 ? '' : 's'}. May be inaccurate.{turn.incomplete ? ' Incomplete.' : ''}
            </span>
            <div className="assistant__answer">{turn.answer}</div>
          </li>
        ))}
      </ol>
      <div className="stack-row">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={state.turns.length === 0}
          onClick={props.onClearHistory}
        >
          <Trash2 size={14} aria-hidden="true" /> Clear assistant history
        </button>
      </div>
    </div>
  );
}
