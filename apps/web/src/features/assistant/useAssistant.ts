import { useCallback, useEffect, useRef, useState } from 'react';
import type { TranscriptSegment } from '../transcription/transcription.types';
import { createDefaultAssistantStore, type AssistantStore } from './assistantStore';
import { AssistantSession } from './assistantSession';
import type { AssistantState, AssistantTask } from './assistant.types';
import { createOllamaClient, getLocalModelConfig } from './localModel';

const MODEL_KEY = 'meetlocal.assistantModel';

function loadModel(): string | null {
  try {
    return window.localStorage.getItem(MODEL_KEY);
  } catch {
    return null;
  }
}

let sharedStore: AssistantStore | null = null;
const getStore = () => (sharedStore ??= createDefaultAssistantStore());

/** Deletes all saved assistant conversations on this device (used by Settings). */
export async function deleteAllAssistantHistory(): Promise<boolean> {
  try {
    await getStore().clearAll();
    return true;
  } catch (error) {
    console.warn('Could not delete assistant history', error);
    return false;
  }
}

const INITIAL: AssistantState = {
  status: 'checking',
  endpoint: '',
  models: [],
  model: null,
  turns: [],
  generating: false,
  error: null,
};

/**
 * React binding for the optional local assistant. Created lazily: nothing contacts the local model
 * server until `enabled` becomes true (the user opened the Assistant panel).
 */
export function useAssistant(meetingId: string, enabled: boolean) {
  const [state, setState] = useState<AssistantState>(INITIAL);
  const sessionRef = useRef<AssistantSession | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const config = getLocalModelConfig(import.meta.env as { VITE_OLLAMA_URL?: string; VITE_OLLAMA_MODEL?: string });
    const session = new AssistantSession(meetingId, {
      client: createOllamaClient(config.endpoint),
      store: getStore(),
      endpoint: config.endpoint,
      preferredModel: loadModel() ?? config.model,
      saveModel: (model) => {
        try {
          window.localStorage.setItem(MODEL_KEY, model);
        } catch (error) {
          console.warn('Could not save model choice', error);
        }
      },
    });
    sessionRef.current = session;
    const unsubscribe = session.subscribe(setState);
    void session.loadHistory();
    void session.refresh();
    return () => {
      unsubscribe();
      session.dispose();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [meetingId, enabled]);

  const refresh = useCallback(() => void sessionRef.current?.refresh(), []);
  const setModel = useCallback((model: string) => sessionRef.current?.setModel(model), []);
  const run = useCallback(
    (task: AssistantTask, segments: TranscriptSegment[], question?: string) =>
      void sessionRef.current?.run(task, segments, question),
    [],
  );
  const cancel = useCallback(() => sessionRef.current?.cancel(), []);
  const clearHistory = useCallback(() => void sessionRef.current?.clearHistory(), []);

  return { state, refresh, setModel, run, cancel, clearHistory };
}
