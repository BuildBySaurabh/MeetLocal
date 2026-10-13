export type EnvLike = Record<string, string | undefined>;

const DEFAULT_STUN = 'stun:stun.l.google.com:19302';

/**
 * Builds the ICE server list from environment configuration, kept separate from the
 * peer-connection code.
 *
 * Privacy: contacting a STUN server reveals your public IP address to it. A TURN relay
 * (if configured) would carry encrypted media for peers that cannot connect directly.
 * No TURN server is configured by default.
 */
export function getIceServers(env: EnvLike): RTCIceServer[] {
  const stunUrls = (env.VITE_STUN_URLS ?? DEFAULT_STUN)
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);

  const servers: RTCIceServer[] = [];
  if (stunUrls.length > 0) servers.push({ urls: stunUrls });

  const turnUrl = env.VITE_TURN_URL?.trim();
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: env.VITE_TURN_USERNAME ?? '',
      credential: env.VITE_TURN_CREDENTIAL ?? '',
    });
  }
  return servers;
}
