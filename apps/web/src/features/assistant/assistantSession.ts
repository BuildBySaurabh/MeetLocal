import type { TranscriptSegment } from '../transcription/transcription.types';
import type { AssistantState, AssistantTask, AssistantTurn } from './assistant.types';
import { LocalModelError, isLocalEndpoint, type LocalModelClient } from './localModel';
import { PromptError, TASK_LABEL, buildPrompt } from './promptBuilder';
import type { AssistantStore } from './assistantStore';

export interface AssistantDeps {
  client: LocalModelClient;
  store: AssistantStore;
  endpoint: string;
  preferredModel: string;
  /** Remembers the model the user picked. */
  saveModel?: (model: string) => void;
  now?: () => number;
  generateId?: () => string;
}

type Listener = (state: AssistantState) => void;

const MODEL_MISSING_HINT = (m: string) => `Model "${m}" is not installed. Install it with: ollama pull ${m}`;

/**
 * Optional local assistant. It never runs by itself: every request is started by the user, uses only the
 * transcript lines they selected, and goes only to a model server on this computer. Framework-free.
 */
export class AssistantSession {
  private state: AssistantState;
  private readonly listeners = new Set<Listener>();
  private abort: AbortController | null = null;
  private disposed = false;
  private readonly now: () => number;
  private readonly generateId: () => string;

  constructor(
    private readonly meetingId: string,
    private readonly deps: AssistantDeps,
  ) {
    this.now = deps.now ?? Date.now;
    this.generateId = deps.generateId ?? (() => `${this.now()}-${Math.random().toString(36).slice(2, 8)}`);
    this.state = {
      status: isLocalEndpoint(deps.endpoint) ? 'checking' : 'blocked-endpoint',
      endpoint: deps.endpoint,
      models: [],
      model: null,
      turns: [],
      generating: false,
      error: null,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  getState(): AssistantState {
    return this.state;
  }

  async loadHistory(): Promise<void> {
    try {
      const turns = await this.deps.store.list(this.meetingId);
      if (!this.disposed) this.update({ turns });
    } catch (error) {
      console.warn('Could not read assistant history', error);
    }
  }

  /** Checks whether the local model server is running and which models it has. Safe to call repeatedly. */
  async refresh(): Promise<void> {
    this.update({ status: this.state.status === 'blocked-endpoint' ? 'blocked-endpoint' : 'checking' });
    let availability;
    try {
      availability = await this.deps.client.checkAvailability();
    } catch {
      return;
    }
    if (this.disposed) return;
    if (availability.kind === 'blocked-endpoint')
      return this.update({ status: 'blocked-endpoint', models: [], model: null });
    if (availability.kind === 'unavailable') return this.update({ status: 'unavailable', models: [], model: null });
    const { models } = availability;
    if (models.length === 0) return this.update({ status: 'no-model', models, model: null });
    const wanted = this.state.model ?? this.deps.preferredModel;
    // Ollama lists names like "llama3.2:latest"; accept a bare name too.
    const match = models.find((m) => m === wanted || m.split(':')[0] === wanted);
    if (match) return this.update({ status: 'ready', models, model: match });
    // The configured model is missing but others exist: let the user choose, never pick silently.
    this.update({ status: 'model-missing', models, model: wanted });
  }

  setModel(model: string): void {
    if (!this.state.models.includes(model)) return;
    this.deps.saveModel?.(model);
    this.update({ model, status: 'ready', error: null });
  }

  async run(task: AssistantTask, segments: TranscriptSegment[], question = ''): Promise<void> {
    if (this.disposed || this.state.generating) return;
    if (this.state.status !== 'ready' || !this.state.model) {
      this.update({ error: 'The local model is not available.' });
      return;
    }
    let built;
    try {
      built = buildPrompt(task, segments, question);
    } catch (error) {
      this.update({ error: error instanceof PromptError ? error.message : 'Could not prepare the request.' });
      return;
    }
    const model = this.state.model;
    const turn: AssistantTurn = {
      id: this.generateId(),
      task,
      prompt: task === 'ask' ? question.trim() : TASK_LABEL[task],
      answer: '',
      model,
      sourceCount: built.sourceCount,
      createdAt: this.now(),
    };
    this.abort = new AbortController();
    this.update({ generating: true, error: null, turns: [...this.state.turns, turn] });

    let failure: string | null = null;
    try {
      await this.deps.client.chat(
        model,
        built.messages,
        (token) => {
          turn.answer += token;
          this.replaceTurn({ ...turn });
        },
        this.abort.signal,
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        turn.incomplete = true;
      } else if (error instanceof LocalModelError && /not found/i.test(error.message)) {
        failure = MODEL_MISSING_HINT(model);
        turn.incomplete = true;
      } else {
        failure = error instanceof LocalModelError ? error.message : 'The local model failed.';
        turn.incomplete = true;
      }
    }
    this.abort = null;
    if (!turn.answer && failure) {
      // Nothing useful was produced: do not keep an empty answer in the history.
      this.update({ generating: false, error: failure, turns: this.state.turns.filter((t) => t.id !== turn.id) });
      if (/ollama pull/.test(failure)) void this.refresh();
      return;
    }
    this.replaceTurn({ ...turn });
    await this.deps.store
      .put(this.meetingId, { ...turn })
      .catch((e: unknown) => console.warn('Could not save assistant turn', e));
    if (!this.disposed) this.update({ generating: false, error: failure });
  }

  cancel(): void {
    this.abort?.abort();
  }

  async clearHistory(): Promise<void> {
    try {
      await this.deps.store.clearMeeting(this.meetingId);
    } catch (error) {
      console.warn('Could not clear assistant history', error);
    }
    this.update({ turns: [] });
  }

  dispose(): void {
    if (this.disposed) return;
    this.abort?.abort();
    this.disposed = true;
    this.listeners.clear();
  }

  private replaceTurn(turn: AssistantTurn): void {
    this.update({ turns: this.state.turns.map((t) => (t.id === turn.id ? turn : t)) });
  }

  private update(patch: Partial<AssistantState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }
}
