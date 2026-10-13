import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { SHORTCUTS } from '../../features/rooms/shortcuts';

interface ShortcutsHelpProps {
  onClose: () => void;
}

export function ShortcutsHelp({ onClose }: ShortcutsHelpProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopImmediatePropagation();
      onClose();
    };
    // Capture phase so Escape closes this dialog before it can close a side panel.
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="side-panel__header">
          <h2 id="shortcuts-title" className="side-panel__title">
            Keyboard shortcuts
          </h2>
          <button ref={closeRef} type="button" className="btn btn--ghost btn--sm" aria-label="Close" onClick={onClose}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
        <dl className="shortcut-list">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.key} className="shortcut-list__row">
              <dt>
                <kbd>{shortcut.key}</kbd>
              </dt>
              <dd>{shortcut.description}</dd>
            </div>
          ))}
        </dl>
        <p className="muted small">Shortcuts are off while you type in a text box. Escape closes panels.</p>
      </div>
    </div>
  );
}
