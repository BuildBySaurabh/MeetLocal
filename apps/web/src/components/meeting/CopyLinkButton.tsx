import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type CopyState = 'idle' | 'copied' | 'failed';

export function CopyLinkButton({ url }: { url: string }) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setState('copied');
    } catch (error) {
      // Clipboard access can be denied (insecure context, permissions). Tell the user how to recover.
      console.warn('Clipboard write failed', error);
      setState('failed');
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 2500);
  }

  return (
    <>
      <button type="button" className="btn btn--secondary btn--sm" onClick={() => void copy()}>
        {state === 'copied' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
        {state === 'copied' ? 'Copied' : 'Copy link'}
      </button>
      <span className="sr-only" role="status">
        {state === 'copied' ? 'Meeting link copied' : ''}
      </span>
      {state === 'failed' ? (
        <span className="field-error" role="alert">
          Could not copy. Select the link and copy it manually.
        </span>
      ) : null}
    </>
  );
}
