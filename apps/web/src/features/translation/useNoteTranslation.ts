import { useCallback, useEffect, useRef, useState } from 'react';
import { createOllamaClient, getLocalModelConfig } from '../assistant/localModel';
import type { NoteEntry } from '../rooms/meetingSession';
import { findLanguage } from './languages';
import { NoteTranslator, type TranslatorState } from './noteTranslator';

const MODEL_KEY = 'meetlocal.assistantModel';

const OFF: TranslatorState = { status: 'off', target: null, translations: new Map(), message: null };

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * React binding for translating the meeting notes into your language with a local model. Off by
 * default; the local model server is only contacted after you pick a language.
 */
export function useNoteTranslation(notes: readonly NoteEntry[]) {
  const [state, setState] = useState<TranslatorState>(OFF);
  const translatorRef = useRef<NoteTranslator | null>(null);

  useEffect(() => {
    const config = getLocalModelConfig(import.meta.env as { VITE_OLLAMA_URL?: string; VITE_OLLAMA_MODEL?: string });
    const translator = new NoteTranslator(createOllamaClient(config.endpoint), () => readStored(MODEL_KEY) || config.model);
    translatorRef.current = translator;
    const unsubscribe = translator.subscribe(setState);
    return () => {
      unsubscribe();
      translator.dispose();
      translatorRef.current = null;
    };
  }, []);

  useEffect(() => {
    translatorRef.current?.sync(notes);
  }, [notes, state.status]);

  const setLanguage = useCallback((code: string) => {
    // Deliberately not remembered: translation starts off in every meeting and only contacts the
    // local model server after you pick a language.
    void translatorRef.current?.setTarget(findLanguage(code));
  }, []);

  return { state, setLanguage };
}
