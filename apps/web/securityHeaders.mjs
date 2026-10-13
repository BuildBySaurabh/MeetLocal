// Content-Security-Policy and related headers for production serving. Used by `vite preview` (so the policy
// can be tested against the built app) and copied into docs/DEPLOYMENT.md for real web servers.
// The dev server is not covered: Vite's hot reload needs inline scripts.

/**
 * @param {{ signalingUrl?: string, extraConnect?: string[] }} options
 */
export function buildSecurityHeaders({ signalingUrl = 'ws://localhost:8787', extraConnect = [] } = {}) {
  const signalingOrigin = (() => {
    try {
      return new URL(signalingUrl).origin.replace(/^http/, 'ws');
    } catch {
      return signalingUrl;
    }
  })();
  const connect = [
    "'self'",
    signalingOrigin,
    // Local language model (Ollama). Only localhost is ever contacted by the app.
    'http://localhost:11434',
    'http://127.0.0.1:11434',
    // Speech model download (first use of transcription). Remove these if you self-host the model files
    // and set VITE_TRANSCRIPTION_MODEL_HOST; add your host to extraConnect instead.
    'https://huggingface.co',
    'https://*.huggingface.co',
    'https://*.hf.co',
    ...extraConnect,
  ];
  const csp = [
    "default-src 'self'",
    // 'wasm-unsafe-eval' allows WebAssembly (speech and face models); blob: is the audio worklet used for transcription.
    "script-src 'self' 'wasm-unsafe-eval' blob:",
    "worker-src 'self' blob:",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob: mediastream:",
    `connect-src ${connect.join(' ')}`,
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  return {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    // The page may use camera, microphone and screen capture itself; nothing else sensitive.
    'Permissions-Policy': 'camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
}
