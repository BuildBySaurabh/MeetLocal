export type AssistantTask = 'summary' | 'notes' | 'actions' | 'questions' | 'explain' | 'practice' | 'study' | 'ask';

export type AssistantStatus =
  | 'checking'
  /** The local model server (Ollama) cannot be reached. */
  | 'unavailable'
  /** Ollama is running but has no models installed. */
  | 'no-model'
  /** The chosen model is not installed. */
  | 'model-missing'
  | 'ready'
  /** The configured endpoint is not on this computer, so it is refused. */
  | 'blocked-endpoint';

export interface AssistantTurn {
  id: string;
  task: AssistantTask;
  /** What the user asked (the question text, or the task name). The transcript itself is not stored here. */
  prompt: string;
  /** The model's answer; may be partial while generating. */
  answer: string;
  model: string;
  /** How many transcript lines were provided to the model. */
  sourceCount: number;
  createdAt: number;
  /** True if generation was stopped or failed part-way. */
  incomplete?: boolean;
}

export interface AssistantState {
  status: AssistantStatus;
  endpoint: string;
  models: string[];
  model: string | null;
  turns: AssistantTurn[];
  generating: boolean;
  /** Last problem that is not about availability, e.g. selection too long or generation failed. */
  error: string | null;
}
