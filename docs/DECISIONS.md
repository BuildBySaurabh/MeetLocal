# Decisions

| # | Decision | Reason |
| --- | --- | --- |
| 1 | npm workspaces monorepo (`apps/*`, `packages/*`) | Required by the brief; keeps one lockfile and shared types. |
| 2 | Shared package compiled to `dist/` (not consumed as raw TS) | The signaling app is built with plain `tsc` and run by Node, which cannot import another package's `.ts`. Root scripts rebuild it first. |
| 3 | zod for protocol validation, schemas in the shared package | Runtime validation of untrusted input is required; one schema serves both client and server and gives inferred types. |
| 4 | `ws` for WebSockets | Small, stable, no framework. |
| 5 | Vite 8, Vitest 5, React 19, React Router 7 | Current versions; Vitest 2 pulled in dev-toolchain advisories (`npm audit` reported 6). Now 0. |
| 6 | Room ID = 16 random bytes, base64url (22 chars) | 128 bits makes guessing impractical. Not a substitute for authentication. |
| 7 | Client generates participant IDs; fresh on every page load | Avoids "duplicate participant" collisions with a half-dead socket after refresh. |
| 8 | `create`/`join` intent on the join message | Lets "room does not exist" be reported for stale links while the creator can still (re)create a room. |
| 9 | Empty rooms linger for 60 s | A host refreshing the page should not break the link. |
| 10 | Offer is made by the participant already in the room | Avoids offer collisions ("glare"); the newcomer waits. |
| 11 | WebSocket upgrade handled manually (`noServer`) | Origin and connection limits can reject with proper HTTP 403/429 before any WebSocket exists. |
| 12 | Plain CSS with tokens (no CSS framework) | Few dependencies, consistent system, easy to maintain. |
| 13 | Unimplemented features are shown disabled/labelled, never simulated | Brief rule: no fake functionality or fake connected status. |
| 14 | `MeetingSession` is a framework-free class; a thin hook subscribes to it | Keeps WebRTC/signaling orchestration testable without React and avoids business logic in components. |
| 15 | Local tracks are toggled with `track.enabled`, not removed | No renegotiation needed for mute/camera, avoiding renegotiation loops. |
| 16 | Receive-only transceivers when a device is missing or denied | A user without camera/microphone can still see and hear the other person. |
| 17 | Preview hook is `useMediaPreview.ts`; device listing is `useDevices.ts` | Named for what each does. |
| 18 | Signaling URL defaults to `<page host>:8787` | Works when the page is opened by LAN IP without extra configuration. |
| 19 | Real-browser check is a Python Playwright script in `scripts/`, not an npm dependency | A Chromium is already available in many environments; avoids adding a heavy dev dependency to the Node workspace. |
| 20 | Screen share and device switching use `replaceTrack` on pre-created `sendrecv` transceivers | No renegotiation, so no new glare/loop risk; also lets a camera-less user start sharing. |
| 21 | Chat goes over the signaling socket (memory only, plain text, 2000 chars) | The brief asks for chat over signaling. The privacy doc states plainly that the server relays it. A WebRTC data channel would keep it off the server and is a candidate later change. |
| 22 | Mic/camera/screen state is sent as `media-state` booleans | The remote side cannot otherwise tell "camera off" from "no video yet". |
| 23 | Speaker choice uses `setSinkId` only where supported; otherwise the UI says system default is used | Not available in Firefox/Safari; no fake control is shown. |
| 24 | Device choices stored as IDs only, under `meetlocal.*` keys | Cleared with the other settings; no labels or media stored. |
| 25 | Transcription uses transformers.js Whisper in a Web Worker, behind a `TranscriptionEngine` interface | Runs in the page with no extra install; whisper.cpp would need a native process. Browser `SpeechRecognition` rejected because Chrome sends audio to a cloud service. |
| 26 | Only the local microphone is transcribed; every line is "You" | Remote audio would need participant consent; no speaker diarization is attempted rather than guessing. |
| 27 | Utterance-based recognition (energy gate), no interim results | Whisper is not streaming; fake interim text would be misleading. |
| 28 | Transcripts in IndexedDB keyed by meeting ID, with memory fallback | Larger than localStorage limits; stays on device; user can export/delete. |
| 29 | ONNX Runtime WASM copied to `public/ort/` and served same-origin; model host configurable | Avoids a CDN request revealing transcription use; allows fully self-hosted models. |
| 30 | `npm install` of transformers.js run with `--ignore-scripts` here | Its optional `onnxruntime-node` postinstall downloads native binaries from a blocked host; the browser build does not need them. |
| 31 | Assistant talks to Ollama directly from the browser, localhost only (guarded in code) | No extra server component; the signaling server never sees prompts. Needs `OLLAMA_ORIGINS`; the panel explains this. |
| 32 | Transcript quoted as data in a user message; each request independent; assistant has no tools | Limits prompt-injection impact and avoids feeding generated text back as "facts". |
| 33 | If the configured model is missing, the user chooses; the app never silently picks another | Brief: communicate clearly when a model is not installed; no hidden substitution. |
| 34 | Assistant lines are opt-in per line; late lines start unselected | User controls what the model sees. |
| 35 | Camera check is a pure-geometry estimator over MediaPipe's 478 landmarks, not the model's 3D transform matrix | Matrix axis/sign conventions could not be verified without the model; geometry on landmarks can be unit-tested. Cost: coarse accuracy, documented. |
| 36 | Face model file is fetched only by an explicit `npm run fetch:face-model`; WASM runtime is copied same-origin | No hidden third-party request at run time; the user decides to contact Google's storage once. |
| 37 | Camera analysis runs on the main thread at ~4 fps (GPU delegate, CPU fallback) | Worker use of MediaPipe's WASM loader could not be verified here; load is small. Revisit if it janks on real devices. |
| 38 | Up/down direction not shown, only magnitude; calibration is user-initiated and in-memory | The sign convention is unvalidated; showing a wrong direction would be worse than showing none. |
| 39 | UI wording avoids any behavioural inference (attention, honesty) and tips concern camera set-up only | Brief's safety requirements for gaze features. Covered by tests that scan the strings. |
| 40 | ESLint flat config with typescript-eslint and react-hooks; `npm run check` chains lint, typecheck, test, build | One command to gate changes. |
| 41 | CSP and security headers defined once in `securityHeaders.mjs`, applied by `vite preview`; deployment copies them | Verified in a real browser without committing to a host. `wasm-unsafe-eval` and `blob:` scripts/workers are needed for Whisper and the AudioWorklet. |
| 42 | One join per connection | Prevents room churn/enumeration from one socket; reconnects use a new socket anyway. |
| 43 | Separate chat rate limiter (burst 8, 2/s) | Chat is relayed by the server, so it needs tighter limits than signaling. |
| 44 | Mobile layout scrolls the page instead of fixed-height panes below 760px | Fixed-height layout overlapped tiles and panels at 390px. |
| 45 | `--text-faint` lightened and `h1` added for contrast/landmark compliance | Found by axe-core. |
| 46 | TURN credentials are not issued by this project; static ones must not be put in `VITE_*` | They would be public in the bundle. |
| 47 | Group calls as a full mesh capped at 4, per-peer state in `MeetingState.remotes`; the single-remote fields remain as copies of the first remote | No media server by design; 4 keeps upload bandwidth workable. Keeping the legacy fields avoided rewriting working code and tests. |
| 48 | A failed peer ends the call only when no other peer is alive | One bad network path should not drop everyone. |
| 49 | Single-key shortcuts that are inert in text fields and with Ctrl/Cmd/Alt; no shortcut for Leave | Avoids accidental typing triggers and accidental hang-ups. |
| 50 | PWA via a hand-written service worker, no plugin; production only; app shell only | No new dependency, no caching of models or meeting data, no stale dev builds. |
| 51 | `render.yaml` uses `sync: false` for the two origin variables | They depend on the generated hostnames. |
| 52 | Signaling accepts platform `PORT` when `SIGNALING_PORT` is unset | Required by Render and similar hosts. |
| 53 | Shared notes are built from each person's own local transcription, opt-in sharing of text lines via the signaling server | Keeps audio and models local. Cost: server can read shared lines; documented. |
| 54 | Others' notes live only in memory; own transcript history stays as before | Avoids storing other people's speech on disk. |
| 55 | Translation of note text via local Ollama; off and not remembered by default | No new model download or cloud; only contacts the local server after a language is chosen. |
| 56 | Background effects use MediaPipe selfie segmentation with canvas compositing; model fetched by an explicit script; mask polarity auto-checked | Matches the face-model pattern; polarity could not be verified on a real person. |
| 57 | Blur is down-scale/up-scale rather than `ctx.filter` | `ctx.filter` is unsupported in Safari. |
| 58 | Below 900px: fixed bottom toolbar (scrolls sideways), panels as bottom sheets, 44px touch targets, keyboard hint hidden on touch | Earlier layout used 300px+ of a phone screen for the toolbar. |
