/**
 * Decides whether a WebSocket upgrade request's Origin header is acceptable.
 *
 * - An exact match against the allow-list is always accepted.
 * - A missing Origin (non-browser clients such as CLI tools) is accepted only outside production.
 * - Everything else is rejected.
 *
 * Origin checks protect against other websites opening sockets from a visitor's browser.
 * They are not authentication: non-browser clients can forge the header.
 */
export function isOriginAllowed(
  origin: string | undefined,
  allowedOrigins: readonly string[],
  production: boolean,
): boolean {
  if (origin === undefined || origin === '') return !production;
  const normalized = origin.replace(/\/+$/, '').toLowerCase();
  return allowedOrigins.some((allowed) => allowed.replace(/\/+$/, '').toLowerCase() === normalized);
}
