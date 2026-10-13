export interface SignalingConfig {
  host: string;
  port: number;
  production: boolean;
  /** Exact origins (scheme + host + port) allowed to open a WebSocket. */
  allowedOrigins: string[];
  /** Trust X-Forwarded-For for client IPs. Enable only behind a reverse proxy you control. */
  trustProxy: boolean;
  maxRooms: number;
  /** How long an empty room stays joinable (covers a creator refreshing the page). */
  emptyRoomTtlMs: number;
  /** Client must send a valid join message within this time after connecting. */
  joinTimeoutMs: number;
  heartbeatIntervalMs: number;
  sweepIntervalMs: number;
  /** Per-connection message rate limit (token bucket). */
  messageBurst: number;
  messagesPerSecond: number;
  /** Stricter limit for chat messages (user text relayed to the other participant). */
  chatBurst: number;
  chatPerSecond: number;
  notesBurst: number;
  notesPerSecond: number;
  /** Per-IP connection limits. */
  maxConnectionsPerIp: number;
  maxConnectionAttemptsPerMinute: number;
}

function intFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid numeric environment value: "${value}"`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SignalingConfig {
  const production = env.NODE_ENV === 'production';
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? (production ? '' : 'http://localhost:5173'))
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (production && allowedOrigins.length === 0) {
    throw new Error('ALLOWED_ORIGINS must be set when NODE_ENV=production');
  }

  return {
    host: env.SIGNALING_HOST ?? '0.0.0.0',
    port: intFromEnv(env.SIGNALING_PORT ?? env.PORT, 8787),
    production,
    allowedOrigins,
    trustProxy: env.TRUST_PROXY === 'true',
    maxRooms: intFromEnv(env.MAX_ROOMS, 1000),
    emptyRoomTtlMs: 60_000,
    joinTimeoutMs: 10_000,
    heartbeatIntervalMs: 30_000,
    sweepIntervalMs: 15_000,
    messageBurst: 60,
    messagesPerSecond: 30,
    chatBurst: 8,
    chatPerSecond: 2,
    notesBurst: 10,
    notesPerSecond: 3,
    maxConnectionsPerIp: 10,
    maxConnectionAttemptsPerMinute: 30,
  };
}
