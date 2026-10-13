# Project status

_Last updated: 2026-10-13 (after the optional enhancements)_

## Round 2 (notes, translation, background, mobile)
- **Shared meeting notes** with speaker names, opt-in sharing, download as .txt/.md; **translation** of notes via local Ollama; **background blur/minimal** via MediaPipe segmentation; **mobile/tablet layout** rewrite. Results: signaling 58/58, web 323/323, lint and build pass; production-build e2e: csp 10, a11y 22, privacy 10, pwa 10, two-browser 40, group 26, notes 22; dev: background 17, assistant 14, camera 11, transcription 8.
- **Not proven**: real speech recognition feeding the notes (own lines covered by unit tests; others' lines tested with a raw client), real translation quality (fake model only), real background segmentation (synthetic mask only; model not downloadable here), real phones/tablets, live speech-to-speech translation (not built).

## Optional enhancements (added after Phase 7)
- **Group calls**: up to 4 participants, full mesh (`MAX_PARTICIPANTS_PER_ROOM = 4`). Verified with 4 real Chromium instances (26 checks). Not tested: real networks, laptops under 4-way load, TURN.
- **Keyboard shortcuts**: m, v, s, c, p, d, t, a, k, `?` (help dialog); inert while typing; unit tests plus real-browser checks.
- **PWA**: manifest, icons, production-only service worker for the app shell. Offline shell verified in Chromium (10 checks); phone install not tested.
- **render.yaml** (Render Blueprint, never deployed from here) and **requirements.txt** (Python e2e scripts only).
Final results: signaling 54/54, web 293/293, lint and build pass; e2e on the production build: csp 10, a11y 22, privacy 10, pwa 10, two-browser 40, group 26; on dev: assistant 14, camera 11, transcription 8 (flaky, needed a rerun).

## Current phase

**Phase 7 (hardening): complete in the sandbox.** ESLint clean; signaling abuse limits; CSP/security headers verified under
`vite preview`; axe-core accessibility pass (22 checks) with contrast, heading, Escape-to-close and 320/390px layout fixes;
privacy audit (10 checks); `npm audit` 0 vulnerabilities; docs/DEPLOYMENT.md and docs/DEPENDENCIES.md added.
Results: signaling 53/53, web 276/276, build ok, e2e: call 36/36, csp 10/10, a11y 22/22, privacy 10/10, transcription 8/8
(occasionally flaky), assistant 14/14, camera 11/11.
**Still unproven:** real Whisper, real Ollama model and the MediaPipe face model have never run here; no two-physical-device
or TURN test; no human keyboard/screen-reader test.

## Implemented

Phase 6:
- `features/eye-tracking/*`, `components/eyetracking/CameraCheckPanel.tsx`: opt-in camera check (face present, head
  turn, tilt, rough eye direction, frame edge, framing tips, calibration), header indicator, no storage/sharing.
- New dependency `@mediapipe/tasks-vision` (installed with `--ignore-scripts`); `scripts/copy-mediapipe.mjs`,
  `scripts/fetch-face-model.mjs` (`npm run fetch:face-model`); `scripts/e2e-camera-check.py`.

Phase 5:
- `features/assistant/*`, `components/assistant/AssistantPanel.tsx`: Ollama adapter with localhost-only guard,
  prompt builder (system prompt, data-block quoting), session (availability states, run/stop, history), IndexedDB
  history, Assistant toolbar button/panel, Settings deletion; `scripts/fake-ollama.mjs`, `scripts/e2e-assistant.py`.

Phase 4:
- `features/transcription/*`, `components/transcript/*`: opt-in transcription of your own microphone, Transcript
  panel with disclosure, model-download progress, pause/resume/stop, "Transcribing on this device" indicator,
  timestamped lines saved in IndexedDB, .txt export, delete (panel and Settings), clear missing-model status.
- `apps/web/scripts/copy-ort.mjs`; new deps `@huggingface/transformers` (runtime) and `fake-indexeddb` (dev).
- Docs: new `docs/LOCAL_AI.md`.

Phase 1 (unchanged): monorepo, shared protocol, signaling server, home/join/settings pages, theme.

Phase 3:
- Camera, microphone and speaker selection (Devices panel; choices saved as IDs), device hot-plug refresh,
  mic level meter, lost-device handling.
- Screen sharing with an explicit "Stop sharing" control (also reacts to the browser's own stop button), via
  `replaceTrack`; remote screen shown letterboxed.
- Chat over signaling (validated, 2000 chars, memory only, unread badge), participant list with mic/camera/screen
  state, remote camera-off avatar via `media-state`, meeting duration, dismissible notices for rate limits etc.
- Refresh/unexpected leave: `pagehide` leaves immediately and releases the camera; bfcache restore starts a fresh session.
- Clear errors for unsupported features (no screen-share support, no speaker selection, device in use, etc.).

Phase 2:
- Camera/microphone access only on user action, with clear states for blocked permission, no device, device in
  use, insecure context and unsupported browsers; microphone-only / camera-only fallback; receive-only join.
- Join page preview with permission badges and "turn off preview".
- Signaling client (validated messages, no sends before open, clean close).
- `PeerSession` (offer/answer, ICE queueing, ICE restart on failure/disconnect, cleanup).
- `MeetingSession` orchestration: roles, peer replacement, error mapping, signaling reconnection with a fresh ID, leave cleanup.
- Meeting page: local and remote tiles with names, real connection status, mute, camera toggle, leave, copy link,
  error screens with "Try again", autoplay-blocked handling.
- ICE servers and signaling URL from environment (`VITE_*`), STUN by default, TURN optional.

## Files created or changed in Phase 3

- New: `features/media/{deviceManager,useDevices,audioLevel}.ts`, `features/rooms/duration.ts`,
  `components/meeting/{ChatPanel,ParticipantList,DevicePanel,LevelMeter}.tsx`, tests `devices.test.ts`,
  `duration.test.ts`, `panels.test.tsx`
- Changed: shared `signaling.ts` (chat, media-state), signaling `roomManager`/`messageRouter` and tests,
  `media.service`, `peerConnection`, `meetingSession` (rewritten), `useRoom`, `preferences`, `MeetingPage`,
  `MeetingToolbar`, `VideoTile`, `StreamVideo`, `SettingsPage`, styles, e2e script, docs

## Files created or changed in Phase 2

- New: `features/media/{media.types,media.service,useMediaPreview}.ts`, `features/signaling/signalingClient.ts`,
  `features/webrtc/{iceManager,peerConnection}.ts`, `features/rooms/{meetingSession,useRoom}.ts`,
  `components/meeting/StreamVideo.tsx`, `src/test/fakes.ts`, six new test files,
  `scripts/e2e-two-browser-call.py`, `docs/WEBRTC_FLOW.md`
- Changed: `VideoTile`, `MeetingToolbar`, `MeetingPage`, `JoinMeetingPage`, `components.css`, `AppRoutes.test.tsx`,
  and the README, TESTING, PRIVACY_AND_SECURITY, DECISIONS docs

## Commands run and results

| Command | Result |
| --- | --- |
| `npm install` / `npm audit` | OK, 0 vulnerabilities |
| `npm run typecheck` | Pass |
| `npm test` | Pass: signaling 51/51, web 276/276 |
| `python3 scripts/e2e-camera-check.py` | 11/11 (no face model) |
| `python3 scripts/e2e-assistant.py` (fake Ollama) | 14/14 |
| `python3 scripts/e2e-transcription.py` | 8/8 (does not include real recognition) |
| `npm run build` | Pass |
| `python3 scripts/e2e-two-browser-call.py` (Chromium, fake devices, servers running) | **36/36 checks passed**, no console errors or warnings |

What the e2e run showed: both sides reached "Connected"; each received a live 640x480 (or 320x240) video track
plus an audio track, with `currentTime` advancing; mute/camera toggles disabled the real local tracks; a third
joiner got "This meeting is full" without disturbing the call; leave returned the other side to "Waiting";
rejoin re-established the call; unknown rooms show "Meeting not found"; denied permission shows the blocked message.
Screenshots were viewed and the layout looked correct.

## Known bugs and limitations

- Camera check: face model never run; accuracy unknown; up/down direction not shown (unvalidated); runs on the main thread; fake camera cannot test detection. The toolbar now has 9 buttons and wraps on narrow screens.
- `e2e-transcription.py` is occasionally flaky here (the blocked model host sometimes takes over a minute to fail); it passes on rerun. A hung model host leaves the panel on "Loading" until Stop (no timeout).
- Assistant: no real model run; requires `OLLAMA_ORIGINS` for the app origin; small models may ignore the answer format or follow injected text; each task is a one-shot request (no multi-turn memory).
- Real transcription output untested (see above). Model: whisper-tiny.en, English only, CPU/WASM single thread unless cross-origin isolated; accuracy and speed unknown here.
- First use downloads ~40 MB from huggingface.co; build output includes ~27 MB of ONNX runtime WASM in `dist/` plus 14 MB in `public/ort/` (only fetched when transcription starts).
- Remote participants are not transcribed; no speaker identification.
- Chat is relayed by the signaling server (memory only), not peer-to-peer; see PRIVACY_AND_SECURITY.
- Speaker selection works only where `setSinkId` exists (Chromium); not testable with fake devices.
- Screen share was verified with Chromium's auto-selected capture source, not a user-picked window; no system audio.
- Switching to a device that is in use elsewhere shows a notice and keeps the old device; real hardware cases untested.
- Chat history is lost on refresh by design.
- STUN only by default; networks needing a TURN relay will show the "could not connect directly" error.
- LAN/second-device use requires HTTPS and `ALLOWED_ORIGINS`; untested.
- Denied-permission flow in the e2e script is simulated (headless Chromium has no prompt); the real prompt path was not exercised.
- No git repository initialized. TURN credential issuing not implemented. Local transcripts/history unencrypted.
- Behavior of reconnection after a real network drop (vs. a simulated socket drop in unit tests) is not verified in a browser.

## Next exact step

1. On a normal machine with internet: run the Phase 4, 5 and 6 manual tests in docs/TESTING.md (real Whisper, Ollama with
`OLLAMA_ORIGINS`, `npm run fetch:face-model`) and fix what they reveal. 2. Test two physical devices over HTTPS, and a TURN
relay. 3. Keyboard and screen-reader pass by a person. 4. `git init`, add a licence/`private` field to the workspace packages.

## Decisions not to change without discussion

See `docs/DECISIONS.md`. In particular: shared package built to `dist/`, protocol lives in `@meetlocal/shared`,
128-bit room IDs, capacity 4 (mesh), server-assigned `from`, existing participant is the offerer, fresh participant ID per
connection, no cloud AI fallback, never display a simulated connection status.
