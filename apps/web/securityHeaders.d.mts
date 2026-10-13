export function buildSecurityHeaders(options?: {
  signalingUrl?: string;
  extraConnect?: string[];
}): Record<string, string>;
