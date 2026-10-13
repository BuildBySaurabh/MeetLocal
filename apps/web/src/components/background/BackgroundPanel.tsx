import {
  MINIMAL_PRESETS,
  describeBackground,
  type BackgroundMode,
  type BackgroundStatus,
} from '../../features/background/background.types';

interface BackgroundPanelProps {
  mode: BackgroundMode;
  status: BackgroundStatus;
  hasCamera: boolean;
  onChange: (mode: BackgroundMode) => void;
}

function same(a: BackgroundMode, b: BackgroundMode): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'blur' && b.kind === 'blur') return a.strength === b.strength;
  if (a.kind === 'minimal' && b.kind === 'minimal') return a.preset === b.preset;
  return true;
}

export function BackgroundPanel({ mode, status, hasCamera, onChange }: BackgroundPanelProps) {
  const options: Array<{ label: string; mode: BackgroundMode }> = [
    { label: 'None', mode: { kind: 'none' } },
    { label: 'Light blur', mode: { kind: 'blur', strength: 'light' } },
    { label: 'Strong blur', mode: { kind: 'blur', strength: 'strong' } },
  ];
  return (
    <div className="background">
      <p className="muted small">
        Your camera picture is processed on this device. Others only receive the finished picture. The first time, a
        small model file is loaded from this app&apos;s own files (see docs/LOCAL_AI.md).
      </p>
      {!hasCamera ? <p className="muted small">Turn on a camera to use background effects.</p> : null}

      <div role="radiogroup" aria-label="Background effect" className="background__options">
        {options.map((option) => (
          <button
            key={option.label}
            type="button"
            role="radio"
            aria-checked={same(mode, option.mode)}
            className={`background__option${same(mode, option.mode) ? ' background__option--on' : ''}`}
            disabled={!hasCamera}
            onClick={() => onChange(option.mode)}
          >
            {option.label}
          </button>
        ))}
        {MINIMAL_PRESETS.map((preset) => {
          const next: BackgroundMode = { kind: 'minimal', preset: preset.id };
          const on = same(mode, next);
          return (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`Minimal background: ${preset.label}`}
              className={`background__option background__swatch${on ? ' background__option--on' : ''}`}
              style={{ backgroundImage: `linear-gradient(${preset.top}, ${preset.bottom})` }}
              disabled={!hasCamera}
              onClick={() => onChange(next)}
            >
              <span className="background__swatch-label">{preset.label}</span>
            </button>
          );
        })}
      </div>

      <p role="status" className="muted small">
        {status.kind === 'loading'
          ? 'Loading the background model…'
          : status.kind === 'on'
            ? `${describeBackground(mode)} is on. Your own tile shows what others see.`
            : status.kind === 'unavailable'
              ? ''
              : 'No effect.'}
      </p>
      {status.kind === 'unavailable' && status.message ? (
        <p role="alert" className="notes__problem">
          {status.message}
        </p>
      ) : null}
      <p className="muted small">
        Edges can look rough in poor light or with busy backgrounds. If you switch to another browser tab, the effect
        may stutter until you come back.
      </p>
    </div>
  );
}
