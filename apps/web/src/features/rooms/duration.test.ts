import { describe, expect, it } from 'vitest';
import { formatDuration } from './duration';

describe('formatDuration', () => {
  it('formats minutes and seconds', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(65_000)).toBe('01:05');
    expect(formatDuration(59_999)).toBe('00:59');
  });
  it('adds hours only when needed', () => {
    expect(formatDuration(3_725_000)).toBe('1:02:05');
  });
  it('treats negative durations as zero', () => {
    expect(formatDuration(-5000)).toBe('00:00');
  });
});
