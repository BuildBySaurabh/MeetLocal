# Privacy and security

Reflects the code as of Phase 6. Items marked *planned* do not exist yet.

## Data flow

| Data | Where it goes today |
| --- | --- |
| Audio / video | Captured only after you click (preview or join). Sent directly browser-to-browser via WebRTC (encrypted by WebRTC: DTLS-SRTP); never to the signaling server. Not recorded. If a TURN relay is configured and needed, it would relay the encrypted stream. |
| Room ID, participant ID, display name | Sent to the signaling server to set up a meeting; held in memory only. |
| SDP offers/answers, ICE candidates | Relayed by the signaling server (not stored or logged). They contain network addresses and codec info. |
| Chat messages | **Relayed by the signaling server** (not peer-to-peer), held in memory only, never stored or logged, discarded when you leave. Rendered as plain text. Limited to 2000 characters and rate limited. The server operator's process can technically see them in transit. |
| Mic/camera/screen-share on/off state | Sent through the signaling server as three booleans so the other side can show the right tile. No media. |
| Screen share | Video only, sent peer-to-peer like the camera. Chosen in the browser's own picker; no system audio. Not recorded. |
| Default display name, chosen camera/microphone/speaker IDs | Saved in this browser's localStorage (IDs only). Deleted by "Delete saved settings". |
| Your microphone audio for transcription | Only if you click Start transcription. Processed on this device (AudioWorklet -> worker); not recorded, not played, not sent anywhere. Pause closes the capture. |
| Transcript text | Stored in this browser's IndexedDB only; never sent to the signaling server or any cloud service. Exportable and deletable (panel and Settings). Not encrypted. |
| Speech model files | Downloaded once by your browser from huggingface.co (or `VITE_TRANSCRIPTION_MODEL_HOST`) and cached; that host sees the request. The ONNX Runtime WASM is served from MeetLocal's own origin. |
| Other participants' speech | Not transcribed (no consent mechanism yet). |
| Camera frames for the camera check | Only if you turn it on. Analysed in memory on this device by a MediaPipe model; frames and landmarks are not stored, logged or sent anywhere; results are shown only to you and are never shared with other participants. No identity or emotion recognition. The face model file is fetched only by the explicit `npm run fetch:face-model` command (from storage.googleapis.com) or from your own host. |
| Assistant prompts (selected transcript lines + your question) | Sent only to a model server on this computer (Ollama at localhost). Non-local endpoints are refused in code. Not sent to MeetLocal's servers or any cloud AI. Nothing is sent until you press a task button. |
| Assistant history | IndexedDB in this browser; clear button and Settings delete. Contains questions and answers, not the transcript. Not encrypted. |
| Cloud AI | Never used. No AI API keys are required or supported. |

## Honest limits of "private"

- STUN servers learn your public IP when you contact them. The default is a public Google STUN server, configurable via environment.
- If a direct connection fails, a TURN relay would carry (encrypted) media and see network metadata. No relay is configured or bundled.
- The signaling server operator can see room IDs, display names, IP addresses and timing.
- The meeting link is the only credential. Anyone who has it can join until the room is full.
- Browser storage is not encrypted and may be readable by others using the same OS account or browser profile.

## Camera and microphone behaviour

- Devices are opened only on a user action and every track is stopped on leave, on turning off the preview,
  on leaving the page, and if you leave while the permission prompt is open.
- The browser's own camera/microphone indicator shows when they are in use. The app shows "Mute" / "Stop video" state.
- The microphone level meter analyses audio locally with Web Audio and produces only a 0-1 number; samples are not stored or sent.
- Your own video is muted locally so you do not hear yourself.

## Signaling server protections (implemented, tested)

- Every frame is parsed and validated with zod; frames over 64 KiB are rejected by the WebSocket layer; SDP and candidate sizes are capped.
- The sender id is assigned by the server; clients cannot spoof `from` or relay outside their room.
- Per-connection token-bucket message rate limit; per-IP concurrent and per-minute connection limits.
- Origin allow-list enforced at upgrade time (missing Origin allowed only outside production). This stops other websites, not non-browser clients.
- Join timeout, heartbeat termination of dead sockets, empty-room expiry, and a cap on the number of rooms.
- Logs contain startup info and socket error class names only. Message contents and room IDs are not logged.
- Rooms are in memory; they vanish on restart.

## Phase 7 additions
- A connection may join only once (`already-joined`), so it cannot churn through rooms; chat has its own token bucket (burst 8, 2/s).
- CSP and security headers (docs/DEPLOYMENT.md). Under `vite preview` the CSP blocked an injected script (e2e-csp.py), and the app still ran calls, chat and screen share without CSP violations.
- `scripts/e2e-privacy-audit.py` (10 checks, plus a signaling-log check that runs only when `SIGNALING_LOG` is set): during a call with chat, HTTP goes only to the app origin, the only WebSocket is signaling, chat text appears only in signaling frames and not in storage, and no chat IndexedDB exists.
- Note: the `meetlocal-transcripts` IndexedDB database is created empty when a meeting loads (history lookup). Nothing is stored until the user opts in.
- Dependency review: `npm audit` reported 0 vulnerabilities on 2026-10-13. See docs/DEPENDENCIES.md.

- The PWA service worker caches only this app's static files; it never sees or stores meetings, chat, transcripts or model files.
- In group calls every participant learns every other participant's IP address (mesh), not only one peer's.

## Shared notes, translation, background (added after Phase 7)
- Shared notes are opt-in per person. Audio never leaves the device; only recognised text lines go through the signaling server, in memory, and only to people in the same room. The server refuses lines from anyone who has not announced sharing, others are told who is sharing (notice, Notes panel, header badge), and sharing switches off when your transcription stops. Notes of other people are kept only in memory in each tab, never in IndexedDB.
- Shared lines are not end-to-end encrypted: the signaling server can technically read them as it relays them (it does not store or log them). Run your own server if that matters.
- Anyone in a meeting can download the notes and keep them; sharing text cannot be taken back.
- Translation sends text only to Ollama on localhost (non-local endpoints are refused).
- Background effects process video locally; the effect is in the video other participants receive, but no frames go anywhere else.

## Not yet addressed
- Locally saved transcripts and assistant history are stored unencrypted in IndexedDB; anyone with access to the browser profile can read them. Use Settings to delete them.
- TURN short-lived credential issuing, scheduled dependency review, and a person-run screen-reader test.
