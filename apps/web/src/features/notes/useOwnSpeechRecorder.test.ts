import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TranscriptionState } from '../transcription/transcription.types';
import { useOwnSpeechRecorder } from './useOwnSpeechRecorder';

const seg = (id: string, endedAt: number, text = id) => ({ id, startedAt: endedAt - 1, endedAt, text, speaker: 'you' as const });
type Input = Pick<TranscriptionState, 'status' | 'segments'>;

describe('useOwnSpeechRecorder', () => {
  it('records new lines once and ignores history from before transcription started', () => {
    const record = vi.fn();
    const now = () => 1000;
    const { rerender } = renderHook(({ t }: { t: Input }) => useOwnSpeechRecorder(t, record, now), {
      initialProps: { t: { status: 'idle', segments: [seg('old', 500)] } as Input },
    });
    expect(record).not.toHaveBeenCalled();
    rerender({ t: { status: 'listening', segments: [seg('old', 500)] } });
    expect(record).not.toHaveBeenCalled();
    rerender({ t: { status: 'listening', segments: [seg('old', 500), seg('new', 1500, 'hello')] } });
    rerender({ t: { status: 'listening', segments: [seg('old', 500), seg('new', 1500, 'hello')] } });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith('hello');
  });

  it('records nothing while transcription is stopped', () => {
    const record = vi.fn();
    renderHook(() => useOwnSpeechRecorder({ status: 'error', segments: [seg('a', 5000)] }, record, () => 0));
    expect(record).not.toHaveBeenCalled();
  });
});
