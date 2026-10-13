/** What is drawn behind you in the video others see. Processing happens on this device only. */
export type BackgroundMode =
  | { kind: 'none' }
  | { kind: 'blur'; strength: 'light' | 'strong' }
  | { kind: 'minimal'; preset: MinimalPresetId };

export type MinimalPresetId = 'white' | 'light-gray' | 'slate' | 'sage' | 'sky';

export interface MinimalPreset {
  id: MinimalPresetId;
  label: string;
  /** Top and bottom colours of a very soft vertical gradient. */
  top: string;
  bottom: string;
}

export const MINIMAL_PRESETS: readonly MinimalPreset[] = [
  { id: 'white', label: 'Clean white', top: '#fafafa', bottom: '#f0f0f0' },
  { id: 'light-gray', label: 'Light gray', top: '#d9dde3', bottom: '#c9ced6' },
  { id: 'slate', label: 'Dark slate', top: '#2b3340', bottom: '#1d2430' },
  { id: 'sage', label: 'Sage', top: '#cfdccf', bottom: '#bccbbc' },
  { id: 'sky', label: 'Soft sky', top: '#d6e6f5', bottom: '#c3d8ee' },
];

export const NO_BACKGROUND: BackgroundMode = { kind: 'none' };

export function findPreset(id: MinimalPresetId): MinimalPreset {
  return MINIMAL_PRESETS.find((p) => p.id === id) ?? MINIMAL_PRESETS[1]!;
}

export function describeBackground(mode: BackgroundMode): string {
  switch (mode.kind) {
    case 'none':
      return 'No effect';
    case 'blur':
      return mode.strength === 'strong' ? 'Strong blur' : 'Light blur';
    case 'minimal':
      return findPreset(mode.preset).label;
  }
}

export type BackgroundStatusKind = 'off' | 'loading' | 'on' | 'unavailable';

export interface BackgroundStatus {
  kind: BackgroundStatusKind;
  /** User-facing explanation for "unavailable" (what is missing and how to fix it). */
  message: string | null;
}

export const BACKGROUND_OFF: BackgroundStatus = { kind: 'off', message: null };
