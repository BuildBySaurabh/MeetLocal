import type { PanelName } from '../../components/meeting/MeetingToolbar';

export type ShortcutAction =
  | { type: 'toggle-mic' }
  | { type: 'toggle-camera' }
  | { type: 'toggle-screen-share' }
  | { type: 'toggle-panel'; panel: PanelName }
  | { type: 'show-help' };

export interface ShortcutInfo {
  key: string;
  description: string;
  action: ShortcutAction;
}

/** Single-letter shortcuts, active in a meeting when no text field has focus. */
export const SHORTCUTS: readonly ShortcutInfo[] = [
  { key: 'm', description: 'Mute or unmute your microphone', action: { type: 'toggle-mic' } },
  { key: 'v', description: 'Turn your camera on or off', action: { type: 'toggle-camera' } },
  { key: 's', description: 'Start or stop sharing your screen', action: { type: 'toggle-screen-share' } },
  { key: 'c', description: 'Open or close chat', action: { type: 'toggle-panel', panel: 'chat' } },
  { key: 'p', description: 'Open or close the people list', action: { type: 'toggle-panel', panel: 'participants' } },
  { key: 'd', description: 'Open or close device settings', action: { type: 'toggle-panel', panel: 'devices' } },
  { key: 't', description: 'Open or close the transcript', action: { type: 'toggle-panel', panel: 'transcript' } },
  { key: 'b', description: 'Open or close background effects', action: { type: 'toggle-panel', panel: 'background' } },
  { key: 'n', description: 'Open or close the shared meeting notes', action: { type: 'toggle-panel', panel: 'notes' } },
  { key: 'a', description: 'Open or close the assistant', action: { type: 'toggle-panel', panel: 'assistant' } },
  { key: 'k', description: 'Open or close the camera check', action: { type: 'toggle-panel', panel: 'camera' } },
  { key: '?', description: 'Show this list', action: { type: 'show-help' } },
];

interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat?: boolean;
  target: EventTarget | null;
}

/** True when the key press is going to a control that uses typing (so shortcuts must not fire). */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

/** Maps a key event to an action, or null. Never matches browser/OS shortcuts (Ctrl/Cmd/Alt). */
export function shortcutForEvent(event: KeyLike): ShortcutAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return null;
  if (isTypingTarget(event.target)) return null;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return SHORTCUTS.find((s) => s.key === key)?.action ?? null;
}
