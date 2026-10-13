# MeetLocal

Privacy-first browser video meetings with optional, locally-run AI.

> **Status: Phase 7 (hardening) done except for manual real-machine checks; see docs/PROJECT_STATUS.md. Phase 6 implemented (camera check: plumbing verified, face model not run here). Phase 5 implemented (assistant tested only against a fake Ollama; no real model run here). Phase 4 implemented (see limits): local, opt-in transcription of your own microphone. Real speech recognition could not be run in the build environment (model host blocked), so it is untested end-to-end. Phase 3 complete: real one-to-one calls with screen sharing, chat, device selection, participant list and
> meeting timer work in Chromium (verified with browser contexts on one machine). Not yet tested across separate
> devices/networks or in Firefox/Safari.** All AI features are not implemented. See [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md).

## Goals

- Up to four people open a link and talk over real audio/video, peer-to-peer (WebRTC, full mesh, no media server).
- Shared meeting notes with names: each person transcribes their own voice on their own device and can opt in to share the text lines; everyone can download the combined notes as .txt or .md. Optional translation of the notes with a local model (Ollama).
- Background blur or minimal backgrounds (local segmentation), and layouts tuned for phones and tablets.
- Keyboard shortcuts (press `?` in a meeting) and an installable PWA (app shell opens offline; calls need the network).
- No media server, no cloud database, no cloud AI service.
- Optional AI (transcription, assistant, approximate gaze/head-pose) running on the user's own device.

## What works today (Phase 6)

| Area | State |
| --- | --- |
| Monorepo (npm workspaces: `apps/web`, `apps/signaling`, `packages/shared`) | Implemented |
| Home page: create meeting, join by link/ID, privacy summary | Implemented |
| Unguessable meeting IDs (128-bit) and shareable links | Implemented |
| Join page: name entry, link validation, copy link, camera/mic preview with permission states | Implemented |
| Real-time audio/video call (WebRTC), mute, camera toggle, leave, connection status, reconnection | Implemented; verified in Chromium, 2 contexts on one machine |
| Settings: default display name, delete saved settings | Implemented |
| Signaling server: rooms, validated protocol, rate limits, origin checks | Implemented, unit + socket tested |
| Camera/microphone/speaker selection (saved on this device), microphone level meter | Implemented; speaker choice only where the browser supports `setSinkId` (Chromium) |
| Screen sharing with a stop control (no renegotiation) | Implemented; verified in Chromium |
| In-meeting chat (plain text, 2000 chars, memory only, via the signaling server) | Implemented |
| Participant list with mic/camera/screen state; remote camera-off shown as an avatar; meeting timer | Implemented |
| Local transcription of your own microphone (Whisper in a Web Worker), pause/resume/stop, local storage, .txt export, delete | Implemented; capture, UI, storage and the missing-model path verified in Chromium. **Real recognition output not verified here** (see docs/LOCAL_AI.md) |
| Optional local assistant (Ollama on localhost): summaries, notes, action items, questions over transcript lines you select; history on device | Implemented; plumbing verified in Chromium against a fake Ollama; **no real model answers verified** |
| Optional, approximate camera check (face present, head turn, rough eye direction, framing tips), only visible to you, nothing stored or sent | Implemented; plumbing verified in Chromium; **needs `npm run fetch:face-model`; real face/pose output never run or validated here** |

## Stack

React, TypeScript, Vite, React Router, lucide-react (web) · Node.js, `ws`, zod (signaling) · Vitest.

## Quick start

Requires Node.js 22.12+ (developed on 22.22) and npm 10+.

```bash
npm install
npm run dev          # signaling on :8787 and web on :5173
```

Open http://localhost:5173. Other commands:

```bash
npm run lint         # ESLint
npm run check        # lint + typecheck + tests + build
npm run typecheck    # all workspaces
npm test             # all workspaces
npm run build        # all workspaces
```

Copy `.env.example` to `.env` to change ports, allowed origins or STUN/TURN settings. See
[docs/DEVELOPMENT_SETUP.md](docs/DEVELOPMENT_SETUP.md).

## Documentation

- [Architecture](docs/ARCHITECTURE.md) · [Project structure](docs/PROJECT_STRUCTURE.md)
- [Development setup](docs/DEVELOPMENT_SETUP.md) · [Testing](docs/TESTING.md)
- [Privacy and security](docs/PRIVACY_AND_SECURITY.md) · [Decisions](docs/DECISIONS.md)
- [Project status](docs/PROJECT_STATUS.md)

## Privacy in one paragraph

Audio/video will travel directly between participants when a peer-to-peer connection succeeds. The signaling
server only relays connection-setup messages and keeps rooms in memory. STUN lookups (and a TURN relay, if you
configure one) can still see network addresses, and a relay would carry encrypted media. MeetLocal does not
claim otherwise. Details in [docs/PRIVACY_AND_SECURITY.md](docs/PRIVACY_AND_SECURITY.md).


See also: docs/DEPLOYMENT.md (HTTPS/WSS, headers, TURN) and docs/DEPENDENCIES.md (licences, audit).

Deploy to Render with the included `render.yaml` (see docs/DEPLOYMENT.md). `requirements.txt` is only for the Python end-to-end test scripts.
