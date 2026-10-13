import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptionState } from '../../features/transcription/transcription.types';
import { TranscriptPanel } from './TranscriptPanel';

afterEach(cleanup);

const base: TranscriptionState = {
  status: 'idle',
  progress: null,
  failure: null,
  busy: false,
  segments: [],
  dropped: 0,
};

function renderPanel(
  state: Partial<TranscriptionState> = {},
  props: Partial<Parameters<typeof TranscriptPanel>[0]> = {},
) {
  const handlers = {
    onStart: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onStop: vi.fn(),
    onClear: vi.fn(),
    onExport: vi.fn(),
  };
  render(
    <TranscriptPanel
      state={{ ...base, ...state }}
      persistent
      hasMic
      micEnabled
      modelName="whisper-tiny.en"
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe('TranscriptPanel', () => {
  it('explains what happens before the user opts in, and starts only on click', () => {
    const h = renderPanel();
    expect(screen.getByText(/runs in your browser/i)).toBeTruthy();
    expect(screen.getByText(/not sent to MeetLocal or any cloud service/i)).toBeTruthy();
    expect(h.onStart).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /start transcription/i }));
    expect(h.onStart).toHaveBeenCalled();
  });

  it('shows model download progress', () => {
    renderPanel({ status: 'loading-model', progress: { fraction: 0.42 } });
    expect(screen.getByRole('status').textContent).toMatch(/42%/);
    expect(screen.getByRole('button', { name: /stop/i })).toBeTruthy();
  });

  it('shows a missing-model failure with a retry button', () => {
    const h = renderPanel({
      status: 'model-unavailable',
      failure: { message: 'The local speech model could not be loaded.', recovery: 'Check your connection.' },
    });
    expect(screen.getByRole('alert').textContent).toMatch(/could not be loaded/);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(h.onStart).toHaveBeenCalled();
  });

  it('offers pause while listening and resume while paused, and says the mic is unused when paused', () => {
    const h = renderPanel({ status: 'listening' });
    fireEvent.click(screen.getByRole('button', { name: /pause/i }));
    expect(h.onPause).toHaveBeenCalled();
    cleanup();
    const h2 = renderPanel({ status: 'paused' });
    expect(screen.getByText(/microphone is not being processed/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /resume/i }));
    expect(h2.onResume).toHaveBeenCalled();
  });

  it('warns when the microphone is muted while listening', () => {
    renderPanel({ status: 'listening' }, { micEnabled: false });
    expect(screen.getByRole('status').textContent).toMatch(/muted/i);
  });

  it('lists segments as plain text; export and delete are enabled only with content', () => {
    renderPanel({
      segments: [{ id: '1', startedAt: 0, endedAt: 1, text: 'hello <i>there</i>', speaker: 'you' }],
    });
    expect(screen.getByText(/hello <i>there<\/i>/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /export/i }) as HTMLButtonElement).disabled).toBe(false);
    cleanup();
    renderPanel();
    expect((screen.getByRole('button', { name: /export/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /delete transcript/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables start without a microphone and reports skipped speech', () => {
    renderPanel({ dropped: 2 }, { hasMic: false });
    expect((screen.getByRole('button', { name: /start transcription/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/2 stretches of speech skipped/i)).toBeTruthy();
  });
});
