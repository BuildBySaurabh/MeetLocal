type Clock = () => number;

/** Token bucket: allows short bursts (e.g. ICE candidates) but caps sustained rate. */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: Clock = Date.now,
  ) {
    this.tokens = capacity;
    this.lastRefill = now();
  }

  /** Returns true if the action is allowed and consumes one token. */
  tryConsume(): boolean {
    const current = this.now();
    const elapsedSeconds = (current - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillPerSecond);
    this.lastRefill = current;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export interface ConnectionLimiterOptions {
  maxConcurrentPerIp: number;
  maxAttemptsPerMinute: number;
  now?: Clock;
}

/** Limits concurrent sockets and connection attempts per client IP. */
export class ConnectionLimiter {
  private readonly active = new Map<string, number>();
  private readonly attempts = new Map<string, number[]>();
  private readonly now: Clock;

  constructor(private readonly options: ConnectionLimiterOptions) {
    this.now = options.now ?? Date.now;
  }

  /** Records an attempt and returns true if the connection may proceed. */
  tryAcquire(ip: string): boolean {
    const current = this.now();
    const windowStart = current - 60_000;
    const recent = (this.attempts.get(ip) ?? []).filter((t) => t > windowStart);
    if (recent.length >= this.options.maxAttemptsPerMinute) {
      this.attempts.set(ip, recent);
      return false;
    }
    if ((this.active.get(ip) ?? 0) >= this.options.maxConcurrentPerIp) {
      this.attempts.set(ip, recent);
      return false;
    }
    recent.push(current);
    this.attempts.set(ip, recent);
    this.active.set(ip, (this.active.get(ip) ?? 0) + 1);
    return true;
  }

  release(ip: string): void {
    const count = (this.active.get(ip) ?? 0) - 1;
    if (count <= 0) this.active.delete(ip);
    else this.active.set(ip, count);
  }

  /** Drops stale attempt records so the map cannot grow without bound. */
  prune(): void {
    const windowStart = this.now() - 60_000;
    for (const [ip, times] of this.attempts) {
      const recent = times.filter((t) => t > windowStart);
      if (recent.length === 0) this.attempts.delete(ip);
      else this.attempts.set(ip, recent);
    }
  }
}
