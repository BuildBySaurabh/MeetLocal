# Development setup

## Prerequisites

- Node.js 22.12 or newer (Vitest 5 requires it; developed on 22.22.0)
- npm 10 or newer
- A modern Chromium, Firefox or Safari browser

Jsdom's transitive dependency `w3c-xmlserializer` asks for Node 22.22.2+. On 22.22.0 npm prints an
`EBADENGINE` warning, but install and tests still work. Upgrading Node removes the warning.

## Install and run

```bash
cd meetlocal
npm install
npm run dev
```

This builds `@meetlocal/shared` once, then starts the signaling server (`ws://localhost:8787`) and the web app
(`http://localhost:5173`). To run them separately: `npm run dev:signaling` and `npm run dev:web`.

`@meetlocal/shared` is compiled to `dist/` and consumed by both apps. If you change files in
`packages/shared/src`, run `npm run build:shared` again (the root `dev`, `test`, `build`, `typecheck` scripts do this for you).

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Signaling + web in watch mode |
| `npm run typecheck` | Type-check all workspaces |
| `npm test` | Run all unit tests |
| `npm run build` | Production build of all workspaces |
| `npm run start -w @meetlocal/signaling` | Run the built signaling server |

## Configuration

Copy `.env.example` to `.env` and adjust. Server variables: `SIGNALING_PORT`, `SIGNALING_HOST`,
`ALLOWED_ORIGINS`, `NODE_ENV`, `TRUST_PROXY`, `MAX_ROOMS`. Client variables (`VITE_*`): `VITE_SIGNALING_URL`
(defaults to `ws(s)://<page host>:8787`), `VITE_STUN_URLS` (defaults to a public Google STUN server), and optional
`VITE_TURN_URL` / `VITE_TURN_USERNAME` / `VITE_TURN_CREDENTIAL`. Vite embeds `VITE_*` values in the browser bundle,
so TURN credentials set this way are visible to every user; use short-lived credentials in real deployments.

In production (`NODE_ENV=production`) the server refuses to start without `ALLOWED_ORIGINS` and rejects
connections without an `Origin` header. Serve it behind TLS so clients use `wss://`.

## Troubleshooting

- **Port 5173/8787/4173 in use**: Vite uses `strictPort`. A stale dev server may also hold 8787 with an old `ALLOWED_ORIGINS`; find it with `ps aux | grep -E "vite|tsx"` and stop it, then restart.
- **`Cannot find module '@meetlocal/shared'`**: run `npm run build:shared`.
- **WebSocket 403**: the page's origin is not in `ALLOWED_ORIGINS` (add `http://localhost:4173` when using `vite preview`). **429**: per-IP connection limit; wait a minute.
- **Install fails in a postinstall script** (`onnxruntime-node` downloading a binary): the browser app does not need it; use `npm install --ignore-scripts`.
- **`public/ort` or `public/mediapipe` missing**: `npm run dev`/`build` copy them; to do it manually run `node apps/web/scripts/copy-ort.mjs` and `copy-mediapipe.mjs` from the repo root.
- **Camera/microphone blocked**: needs `https://` or `localhost`, and permission granted in the browser's site settings. A device in use by another app shows a notice.
- **Assistant says Ollama is unreachable**: start Ollama; set `OLLAMA_ORIGINS` to include the app origin (e.g. `http://localhost:5173`) and restart it.
- **"model not found" in the assistant**: `ollama pull llama3.2` (or the model in `VITE_OLLAMA_MODEL`).
- **Transcription stuck on Loading**: the model host is unreachable; press Stop, check the connection or set `VITE_TRANSCRIPTION_MODEL_HOST`.
- **Camera check says the face model is missing**: run `npm run fetch:face-model` once.
- **Blocked by CSP in `vite preview`**: a custom host (self-hosted model, different signaling URL) must be added to `buildSecurityHeaders` inputs, see docs/DEPLOYMENT.md.

## Using a second device

Browsers only allow camera and microphone on `https://` pages or `localhost`. To test from another device, serve the
web app over HTTPS (for example with a trusted local certificate or a tunnel), point `VITE_SIGNALING_URL` at a `wss://`
signaling endpoint, and add the page's origin to `ALLOWED_ORIGINS`. This setup has not been tested yet.
