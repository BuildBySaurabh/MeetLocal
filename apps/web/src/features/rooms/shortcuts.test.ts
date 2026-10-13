import { describe, expect, it } from 'vitest';
import { SHORTCUTS, shortcutForEvent } from './shortcuts';

function key(k: string, extra: Partial<Parameters<typeof shortcutForEvent>[0]> = {}) {
  return shortcutForEvent({ key: k, ctrlKey: false, metaKey: false, altKey: false, target: document.body, ...extra });
}

describe('keyboard shortcuts', () => {
  it('maps the documented keys to actions, case-insensitively', () => {
    expect(key('m')).toEqual({ type: 'toggle-mic' });
    expect(key('M')).toEqual({ type: 'toggle-mic' });
    expect(key('v')).toEqual({ type: 'toggle-camera' });
    expect(key('s')).toEqual({ type: 'toggle-screen-share' });
    expect(key('c')).toEqual({ type: 'toggle-panel', panel: 'chat' });
    expect(key('?')).toEqual({ type: 'show-help' });
  });

  it('has unique keys and a description for each', () => {
    expect(new Set(SHORTCUTS.map((s) => s.key)).size).toBe(SHORTCUTS.length);
    expect(SHORTCUTS.every((s) => s.description.length > 5)).toBe(true);
  });

  it('ignores unknown keys, key repeat and browser shortcuts', () => {
    expect(key('x')).toBeNull();
    expect(key('Enter')).toBeNull();
    expect(key('m', { repeat: true })).toBeNull();
    expect(key('c', { ctrlKey: true })).toBeNull();
    expect(key('s', { metaKey: true })).toBeNull();
    expect(key('d', { altKey: true })).toBeNull();
  });

  it('never fires while typing in a text field', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      expect(key('m', { target: document.createElement(tag) })).toBeNull();
    }
    const editable = document.createElement('div');
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(key('m', { target: editable })).toBeNull();
    expect(key('m', { target: document.createElement('button') })).toEqual({ type: 'toggle-mic' });
  });
});
