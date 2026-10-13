# Project structure

Only files that exist today are listed. The target tree in the project brief is created incrementally.

```
meetlocal/
├── package.json              npm workspaces + root scripts
├── tsconfig.base.json        strict TypeScript settings shared by all packages
├── .env.example              placeholder configuration (no secrets)
├── apps/
│   ├── web/                  React + Vite client
│   │   ├── public/models/    placeholder README only; model weights are git-ignored
│   │   └── src/
│   │       ├── main.tsx, App.tsx
│   │       ├── routes/       HomePage, JoinMeetingPage, MeetingPage, SettingsPage, AppRoutes
│   │       ├── components/
│   │       │   ├── layout/   AppHeader, ErrorBoundary
│   │       │   └── meeting/  VideoTile, StreamVideo, MeetingToolbar, CopyLinkButton, ChatPanel, ParticipantList, DevicePanel, LevelMeter
│   │       │   └── transcript/ TranscriptPanel, TranscriptLine
│   │       ├── features/
│   │       │   ├── media/       media.service.ts (getUserMedia/getDisplayMedia + errors), useMediaPreview.ts, deviceManager.ts, useDevices.ts, audioLevel.ts
│   │       │   ├── signaling/   signalingClient.ts (typed WebSocket client)
│   │       │   ├── webrtc/      peerConnection.ts (PeerSession), iceManager.ts (STUN/TURN config)
│   │       │   ├── eye-tracking/  gaze.types, gazeEstimator (pure geometry), faceLandmarker (MediaPipe adapter), eyeTrackingSession, useEyeTracking
│   │       │   ├── assistant/     localModel (Ollama adapter), promptBuilder, assistantSession, assistantStore, useAssistant
│   │       │   ├── transcription/ audioSegmenter, audioCapture, transcriptionEngine, whisper.worker, transcriptStore, transcriptionSession, useTranscription
│   │       │   └── rooms/       meetingSession.ts (orchestration), useRoom.ts (React hook), room.service.ts, duration.ts
│   │       ├── test/         fakes.ts (media/RTC test doubles)
│   │       ├── hooks/        useDisplayName
│   │       ├── services/     preferences.ts (localStorage preferences)
│   │       └── styles/       tokens.css, base.css, components.css
│   └── signaling/            WebSocket signaling server
│       └── src/
│           ├── index.ts, config.ts, server.ts
│           ├── rooms/        roomManager.ts, room.types.ts
│           ├── signaling/    messageRouter.ts, messageValidator.ts
│           ├── security/     rateLimiter.ts, originValidator.ts
│           └── tests/        rooms.test.ts, signaling.test.ts
├── scripts/                  e2e-two-browser-call.py, e2e-transcription.py, e2e-assistant.py, e2e-camera-check.py, fake-ollama.mjs
├── packages/shared/src/      meeting.ts, participant.ts, signaling.ts (protocol + zod schemas)
└── docs/
```

## Responsibilities

- `routes/`: page-level components and route wiring.
- `components/`: presentational pieces with no networking logic.
- `features/<name>/`: domain code per feature (types, services, hooks). `media`, `signaling`, `webrtc` and `rooms` hold the call logic.
- `services/`: small cross-cutting services (preferences).
- `apps/signaling/src/signaling/messageRouter.ts`: the only place that interprets client messages.
- `packages/shared`: single source of truth for protocol types and validation.

## Deviations from the brief's tree

- `apps/signaling/src/signaling/signaling.types.ts` is not created: the protocol types live in
  `@meetlocal/shared` to avoid duplicate definitions. `messageValidator.ts` re-exports shared validation.
- Empty placeholder directories (`hooks`, `stores`, `workers`, `utils`, `types`) are not created until used.
