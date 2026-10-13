# Architecture

## Overview

```
Browser A  <──── WebRTC (audio/video, direct when possible) ────>  Browser B
   │                                                                   │
   └──────── WebSocket (signaling only) ──►  Signaling server ◄────────┘
                                             (in-memory rooms)
```

Each browser runs its own optional local features (transcription, AI, gaze estimation) in later phases.
The signaling server never receives media, transcripts or AI prompts.

## Components

- **`apps/web`**: React + Vite single-page app. UI components render, hooks bridge React lifecycle,
  services hold logic, `features/*` hold domain modules.
- **`apps/signaling`**: Node.js + `ws`. Validates every frame, manages rooms in memory, relays offers,
  answers and ICE candidates between members of the same room.
- **`packages/shared`**: zod schemas and TypeScript types for the signaling protocol, room ID and
  participant helpers. Both apps import these, so the protocol is defined once.

## Signaling protocol (v1)

Client to server: `join`, `offer`, `answer`, `ice-candidate`, `leave`.
Server to client: `joined`, `participant-joined`, `participant-left`, `offer`, `answer`, `ice-candidate`, `error`.

- `join` carries `roomId`, a client-generated `participantId`, `displayName` and `intent` (`create` or `join`).
  `join` against a missing room fails with `room-not-found`; `create` makes it.
- The server sets `from` on relayed messages from session state. Client-supplied sender fields are ignored.
- Relay is restricted to members of the sender's own room.
- Capacity is `MAX_PARTICIPANTS_PER_ROOM` (4, in `@meetlocal/shared`). Group calls are a full mesh: every pair has its own peer connection, so each participant uploads their video once per other participant. That is why the limit is small. There is no SFU/media server by design.

## Room lifecycle

Rooms exist only in memory. A room is created by a `create` join, removed after it has been empty for 60 s
(so a host refreshing the page does not lose the link), and lost entirely on server restart.
Sockets that do not join within 10 s, or stop answering heartbeats, are closed and their members removed.

## Trade-offs

- **P2P instead of an SFU**: no media server cost and media stays off our infrastructure, but mesh does not
  scale to large groups and some networks need a TURN relay.
- **In-memory rooms**: simplest, no database holding meeting metadata; rooms do not survive restarts and a
  single instance cannot be load-balanced without sticky routing or shared state.
- **Room ID as the only credential**: 128-bit random IDs are unguessable but anyone with the link can join
  (until the room is full). Not suitable as strong authentication for sensitive meetings.

## Planned (not implemented)

WebRTC call setup and media (Phase 2), reliability features (Phase 3), local transcription (Phase 4),
local AI assistant (Phase 5), approximate gaze assistance (Phase 6).

## Hardening (Phase 7)
Security headers/CSP come from `apps/web/securityHeaders.mjs`; signaling enforces one join per connection and a chat rate limit. See docs/PRIVACY_AND_SECURITY.md and docs/DEPLOYMENT.md.

## Notes, translation, background, responsive layout
- Protocol additions: `transcript-sharing` and `transcript-segment` (client and server), relayed like chat with a separate rate limit and a server-side "must have announced sharing" rule.
- `MeetingSession` also owns the notes list, sharing flags and the background processor. The processed canvas track replaces the camera track on every peer (`replaceTrack`); screen share still takes priority.
- `features/notes` (formatting, own-speech recorder), `features/translation` (Ollama-backed `NoteTranslator`), `features/background` (processor, segmenter, mask helpers).
- Layout: below 900px the page scrolls, controls are a fixed bottom bar and panels are bottom sheets.
