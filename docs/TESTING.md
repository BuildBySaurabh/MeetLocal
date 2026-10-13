# Testing

## Automated (Vitest)

```bash
npm test                              # everything
npm run test -w @meetlocal/signaling  # signaling only
npm run test -w @meetlocal/web        # web only
```

### Signaling (46 tests)

- Room creation, join-vs-create intent, duplicate IDs, capacity, room cap, leave semantics, empty-room expiry.
- Message validation (malformed, oversized, bad IDs/names/SDP) and non-echo of message content.
- Router behavior: relay with server-assigned sender, cross-room isolation, join-before-signal, self-send, disconnect notices, rate limiting.
- Token bucket, per-IP connection limiter, origin validation, production config requirements.
- Real WebSocket integration: two sockets exchanging join/offer/leave, origin rejection (403), join timeout, health check.

### Web (112+ tests; see `npm test` for the current count)

- Meeting link/ID parsing and ID generation.
- Preferences storage including blocked-storage fallback.
- Page behavior: home create/join flows, invalid link errors, name validation, join preview (no camera access until asked, blocked-permission message), meeting screen shows the real session status, wires mute/camera/leave, disables controls for missing devices, media-failure and connection-failure screens, settings save/delete with confirmation. (The session hook is mocked here.)
- Phase 3: chat send/receive/limits, media-state signaling, screen share start/stop/cancel, device switching and removal, device enumeration, microphone level meter (fake `AudioContext`), saved device choices, duration formatting, toolbar/chat/participant UI.
- Media service: error classification, microphone-only / camera-only fallback, no retry on permission denial, track release.
- Signaling client: validation of server messages, send-before-open, close semantics, URL and ICE configuration.
- `PeerSession` (fake `RTCPeerConnection`): offer/answer, ICE candidate queueing, ICE restart limits, disconnect grace period, cleanup.
- `MeetingSession` (fake signaling and peer): who offers, answering, peer replacement, ICE failure, server errors, reconnection with a fresh ID, media failure, toggles, leave cleanup including leaving while the permission prompt is open.

- Phase 4 (`transcription.test.ts`, `TranscriptPanel.test.tsx`): energy-gate segmenter, downsampling, AudioWorklet capture (fake context), worker engine protocol (fake worker), memory and IndexedDB (`fake-indexeddb`) stores, session lifecycle (opt-in, model-unavailable, no mic, pause/resume, stop, mic switch, backlog dropping, history/clear), panel states.

- Phase 5 (`assistant.test.ts`, `AssistantPanel.test.tsx`): local-only endpoint guard, Ollama client (model list, NDJSON streaming incl. split chunks, error mapping, no request to non-local hosts), prompt builder (system prompt content, data block, injection handling, ordering, size limit), stores (memory + IndexedDB), session (unavailable / no-model / model-missing / blocked, selected-lines-only, stop, failure handling, history), panel states.

- Phase 6 (`eyeTracking.test.ts`, `CameraCheckPanel.test.tsx`): estimator geometry on synthetic landmarks (facing, turning, eye direction, blink, roll, frame edge, calibration), suggestions contain no behavioural claims, session lifecycle (opt-in, missing model, no camera, camera off, face lost, calibrate, repeated failures, stop releases resources), MediaPipe adapter against a fake library (missing model incl. dev-server HTML, GPU->CPU fallback, increasing timestamps), panel disclaimers and states.

## What the unit tests do NOT prove

The WebRTC, media and session tests use fakes (jsdom has no `RTCPeerConnection` or `MediaStream`). They prove our
logic, not that real calls work. Use the real-browser checks below for that.

## Automated real-browser check

`scripts/e2e-two-browser-call.py` drives two separate Chromium contexts through a real call using Chromium's
fake camera/microphone devices. Start the servers (`npm run dev`) and run:

```bash
pip install playwright && playwright install chromium
python3 scripts/e2e-two-browser-call.py ./screenshots
```

It checks 36 things (21 call/leave/error checks plus chat both ways incl. HTML shown as text, unread badge, remote camera-off display, real screen-share frames received via track replacement, stop sharing, device lists, level meter, microphone switch, page refresh rejoin, and a viewer with no devices receiving video). The original 21: link creation, preview, both sides reaching Connected, real video frames/audio tracks
arriving and advancing, names, mute/camera toggles disabling real tracks, a third joiner being rejected,
leave and rejoin, unknown-room error, and the blocked-permission message. Headless Chromium has no permission
prompt, so denial is simulated by stubbing `getUserMedia` to reject with `NotAllowedError`.

Limits: both browsers run on one machine over localhost, so this does not exercise STUN/TURN or NAT traversal,
and fake devices do not prove real hardware works.

## Transcription real-browser check

`scripts/e2e-transcription.py` (8 checks): nothing is downloaded before opting in; real microphone capture through the
production AudioWorklet module delivers ~16 kHz audio with signal; with the model host unreachable (this sandbox) the
panel shows the "model could not be loaded" message and a retry; no transcript traffic on the signaling socket; the
ONNX runtime is not requested from a CDN.

**Not covered anywhere:** actual recognised text. That needs the ~40 MB model. To test on a normal machine: `npm run dev`,
join a meeting, open Transcript, Start transcription, wait for the download, speak, and check lines appear; reload and
confirm they return; export and delete.

## Assistant real-browser check (fake Ollama)

`scripts/e2e-assistant.py` starts `scripts/fake-ollama.mjs` (an HTTP stand-in that echoes how many lines it received; it
is **not** a language model). 14 checks: unavailable state while the meeting keeps working, availability re-check, model
choice, only ticked lines reach the server, transcript inside a data block with an injection-style line contained,
streamed answer with its "generated locally" label, history surviving a refresh, clearing history, and no requests to
any host except the app, signaling and localhost Ollama. (Two of the 14 are weak "step reached" checks.)

**Not covered:** real model quality, whether a real model respects the two-section format or resists injection.
To test: install Ollama and a model (docs/LOCAL_AI.md), seed a transcript with transcription, open Assistant, run tasks
on a few lines, and read the answers critically.

## Camera check real-browser check

`scripts/e2e-camera-check.py` (11 checks): disclaimer shown before opting in; nothing from MediaPipe requested before opt-in;
the production frame source plays real frames from the fake camera and leaves the call's camera track alive; MediaPipe's
WASM files are served from this origin; with the face model absent the panel shows the install message and retry, with no
request to Google/CDN hosts and nothing about it on the signaling socket.

**Not covered anywhere:** the face model itself. Chromium's fake camera shows a synthetic pattern, not a face. To test:
`npm run fetch:face-model`, `npm run dev`, join, open Camera check, turn on, and with a real face try: facing the camera,
turning left/right (check the left/right wording matches YOUR left/right), moving out of frame, covering the camera,
turning the camera off, Calibrate. Expect rough numbers; report anything systematically wrong.

## Manual two-browser procedure

1. `npm run dev`.
2. Browser A: open http://localhost:5173, click **New meeting**, enter a name, copy the link.
3. Browser B (different profile or device on the same network): open the link, enter a name, join.
4. Expect two-way audio and video, correct names, working mute/camera/leave, and a clear status on failure.
5. Repeat across separate networks to exercise STUN/TURN behavior.

6. Also try: deny permission, unplug the camera, close one tab mid-call, stop and restart the signaling server,
   and open the link in a third browser (expect "This meeting is full").

For a second physical device, serve the web app over HTTPS (browsers block camera/microphone on plain HTTP except
`localhost`) and set `ALLOWED_ORIGINS` to that origin. This has **not** been tested yet.

## Lint and full check (Phase 7)
`npm run lint` (ESLint flat config) and `npm run check` (lint, typecheck, tests, build). Signaling has 53 tests, web 276.

## Production-build checks (CSP, accessibility, privacy)
These need the production build served with its security headers:
1. `npm run build`
2. Start signaling with `ALLOWED_ORIGINS=http://localhost:5173,http://localhost:4173 npm run dev -w @meetlocal/signaling`
3. `npm run preview -w @meetlocal/web` (port 4173)
4. Run each with `MEETLOCAL_BASE=http://localhost:4173 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers python3 -I scripts/<name>.py`:
   `e2e-csp.py` (10), `e2e-a11y.py` (22: axe-core, Escape closes panels, focus visible, no overflow at 390/320px),
   `e2e-privacy-audit.py` (10), `e2e-two-browser-call.py` (36).
Automated axe checks do not replace a person using a keyboard and screen reader; that has not been done.

## Group calls, PWA and shortcuts
- `scripts/e2e-group-call.py` (dev servers, 4 Chromium instances with fake devices): everyone receives everyone's video/audio, a fifth person is refused, chat reaches all, one leaving keeps the rest connected (26 checks).
- `scripts/e2e-pwa.py` (production preview): manifest, icons, service worker controls the page, app shell opens offline, no model files cached (10 checks).
- Shortcuts are covered by unit tests and by checks inside `e2e-two-browser-call.py` (40 checks).
- Not tested: more than 4 people, poor networks, bandwidth/CPU limits of a 4-way mesh on real laptops, installing the PWA on a phone.

## Notes, translation, background, mobile
- `scripts/e2e-notes.py` (dev or preview; needs `node scripts/fake-ollama.mjs`): a third participant is a raw WebSocket client, since speech recognition cannot run here. 22 checks: consent rules, relay, names, translation through the fake local model, .txt/.md download, clear, shortcut.
- `scripts/e2e-background.py` (dev server): real `BackgroundProcessor` with a synthetic mask on Chrome's fake camera: pass-through, solid replacement, blur, cut-out, track ends on stop, missing-model message, panel UI (17 checks). Real segmentation quality is NOT tested.
- Mobile/tablet: checked with Playwright device emulation (390x844, 820x1180, 844x390 landscape): no horizontal scroll, no tap target under 44px, screenshots reviewed. Not tested on real phones or tablets (iOS Safari in particular).
- Run the whole set before changing layout or the session: lint, tests, then e2e-csp, a11y, privacy-audit, pwa, two-browser-call, group-call on the preview build; notes, background, assistant, camera-check, transcription on dev.
