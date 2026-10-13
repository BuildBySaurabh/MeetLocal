import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearPreferences, loadDisplayName, saveDisplayName, validateDisplayName } from './preferences';

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('preferences', () => {
  it('round-trips a display name', () => {
    expect(saveDisplayName('Alice')).toBe(true);
    expect(loadDisplayName()).toBe('Alice');
  });

  it('ignores an invalid stored name', () => {
    window.localStorage.setItem('meetlocal.displayName', 'x'.repeat(100));
    expect(loadDisplayName()).toBe('');
  });

  it('clears saved preferences', () => {
    saveDisplayName('Alice');
    expect(clearPreferences()).toBe(true);
    expect(loadDisplayName()).toBe('');
  });

  it('degrades gracefully when storage is unavailable', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadDisplayName()).toBe('');
    expect(saveDisplayName('Alice')).toBe(false);
  });

  it('validates display names', () => {
    expect(validateDisplayName('  Bob  ')).toEqual({ ok: true, value: 'Bob' });
    expect(validateDisplayName('   ').ok).toBe(false);
    expect(validateDisplayName('a'.repeat(41)).ok).toBe(false);
  });
});
