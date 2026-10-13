import { useCallback, useState } from 'react';
import { loadDisplayName, saveDisplayName, validateDisplayName } from '../services/preferences';

/** Display name state backed by a small localStorage preference. */
export function useDisplayName() {
  const [name, setName] = useState<string>(() => loadDisplayName());

  const validation = validateDisplayName(name);

  /** Persists the trimmed name; returns the saved value or null when invalid. */
  const commit = useCallback((): string | null => {
    const result = validateDisplayName(name);
    if (!result.ok) return null;
    saveDisplayName(result.value);
    return result.value;
  }, [name]);

  return {
    name,
    setName,
    isValid: validation.ok,
    error: validation.ok ? null : validation.error,
    commit,
  };
}
