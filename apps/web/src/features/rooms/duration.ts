import { useEffect, useState } from 'react';

/** 65_000 -> "01:05", 3_725_000 -> "1:02:05". Negative values count as zero. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const two = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${two(minutes)}:${two(seconds)}`;
}

/** Elapsed milliseconds since `startedAt`, refreshed every second. Null when not started. */
export function useElapsed(startedAt: number | null, now: () => number = Date.now): number | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (startedAt === null) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return startedAt === null ? null : now() - startedAt;
}
