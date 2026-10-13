# Deployment

Nothing here has been tested on a real public host; the CSP and headers were verified only under `vite preview`.

## Requirements
- **HTTPS for the web app.** Browsers expose camera, microphone and screen capture only on `https://` or `localhost`.
- **WSS for signaling.** Terminate TLS at a reverse proxy and forward to the signaling server (`ws://127.0.0.1:8787`).
- Build the app with the final signaling URL: `VITE_SIGNALING_URL=wss://signal.example.com npm run build`.

## Signaling server
```
NODE_ENV=production
ALLOWED_ORIGINS=https://meet.example.com
TRUST_PROXY=true          # only behind your own proxy; otherwise per-IP limits see the proxy's address
MAX_ROOMS=1000
```
In production the server refuses to start without `ALLOWED_ORIGINS` and rejects connections lacking an `Origin`.
Origin checks stop other websites, not scripted clients; rate limits, one join per connection, room capacity 4 and
unguessable 128-bit room IDs are the remaining protections. Rooms are in memory, so a restart ends meetings.
Proxy must pass WebSocket upgrades (nginx: `proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`
and a long `proxy_read_timeout`).

## Security headers
`apps/web/securityHeaders.mjs` is the single source (`buildSecurityHeaders`). `vite preview` applies it; for real hosting,
copy the same headers to your static server. Print them with:
`node -e "import('./apps/web/securityHeaders.mjs').then(m=>console.log(m.buildSecurityHeaders({signalingUrl:'wss://signal.example.com'})))"`.
Headers set: Content-Security-Policy, X-Content-Type-Options, Referrer-Policy: no-referrer, Permissions-Policy
(camera, microphone, display-capture for self only), Cross-Origin-Opener-Policy.
The CSP `connect-src` allows self, the signaling origin, local Ollama (`localhost:11434`) and the Hugging Face hosts for the
one-time Whisper download. If you self-host model files, remove the Hugging Face entries and add your host.
Cross-origin isolation (COOP + COEP) would enable multi-threaded WASM but COEP is not set; transcription runs single-threaded.

## TURN
STUN alone fails on some networks (symmetric NAT, strict firewalls). Run coturn and set `VITE_TURN_URL`.
**Do not** put a long-lived TURN secret in `VITE_*` variables: they are compiled into the public bundle, so anyone could
reuse your relay. For public deployments use short-lived credentials (coturn `use-auth-secret` + a small endpoint that
issues them); this endpoint is not implemented. A relay sees encrypted media only (DTLS-SRTP) but sees metadata.
STUN and TURN servers learn participants' public IPs; peers learn each other's IPs too. Self-host STUN to avoid Google's.

## Model files
Whisper downloads from Hugging Face on first use unless `VITE_TRANSCRIPTION_MODEL_HOST` points to your server. The face model
is fetched by `npm run fetch:face-model` or served from `VITE_FACE_MODEL_URL`. Ollama stays on each user's machine and needs
`OLLAMA_ORIGINS` to include the app origin.

## Not done
Container images, process supervision, monitoring, and TURN credential issuing.

## Render
`render.yaml` is a Blueprint for a Node signaling web service and a static site. Steps: push the repo to GitHub; Render > New > Blueprint;
create it, then set `VITE_SIGNALING_URL=wss://<signaling-host>` on the static site (build-time, so redeploy) and
`ALLOWED_ORIGINS=https://<web-host>` on the signaling service. The signaling server reads Render's `PORT` automatically. Not tested on Render
from here; the CSP in `render.yaml` allows `wss://*.onrender.com` and should be narrowed to your signaling host. No TURN is included, and free
instances sleep and drop in-memory rooms.

## PWA
`public/sw.js` caches only same-origin app-shell files (not `/ort`, `/models`, `/mediapipe`, wasm, or any cross-origin or non-GET request). It is
registered in production builds only. Serve `sw.js` with `Cache-Control: no-cache` (included in `render.yaml`). Installing needs HTTPS.
