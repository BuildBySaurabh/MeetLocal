# MeetLocal — Privacy-First Video Meetings with Local AI

<p align="center">
  <strong>Private conversations. Real-time collaboration. AI that runs on your device.</strong>
</p>

<p align="center">
  A browser-based video meeting application built with React, TypeScript, WebRTC, and optional local AI.
  Join a room through a link, collaborate in real time, and keep AI processing on your own machine.
</p>

<p align="center">
  <a href="https://github.com/BuildBySaurabh/MeetLocal">
    <img src="https://img.shields.io/badge/Project-MeetLocal-2563EB?style=for-the-badge&logo=webrtc&logoColor=white" alt="MeetLocal" />
  </a>
  <img src="https://img.shields.io/badge/Frontend-React%20%2B%20TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="React and TypeScript" />
  <img src="https://img.shields.io/badge/Communication-WebRTC-333333?style=for-the-badge&logo=webrtc&logoColor=white" alt="WebRTC" />
  <img src="https://img.shields.io/badge/AI-Local%20First-16A34A?style=for-the-badge" alt="Local AI" />
</p>

<p align="center">
  <a href="https://github.com/BuildBySaurabh/MeetLocal">Source Code</a> ·
  <a href="https://github.com/BuildBySaurabh/MeetLocal/blob/main/docs/ARCHITECTURE.md">Architecture</a> ·
  <a href="https://github.com/BuildBySaurabh/MeetLocal/blob/main/docs/PRIVACY_AND_SECURITY.md">Privacy & Security</a> ·
  <a href="https://github.com/BuildBySaurabh/MeetLocal/blob/main/docs/LOCAL_AI.md">Local AI Setup</a>
</p>

### <p align = "center"> Live Demo : https://meetlocal-inix.onrender.com</p>
---

## Overview

MeetLocal is a privacy-focused video meeting application designed to explore how real-time communication and AI-assisted collaboration can work without relying on a centralized media server or cloud AI services.

Participants can join a meeting through a shareable link, communicate using their microphones and cameras, share their screens, and collaborate through chat and meeting notes.

Optional AI features run locally on the user's device. Speech transcription uses Whisper in the browser, while the meeting assistant and translation features can use a local Ollama model.

I built MeetLocal as a learning project to explore WebRTC, real-time signaling, browser-based machine learning, local LLM integration, and privacy-conscious application architecture.

> **Design principle:** Keep communication direct where possible, minimize server responsibilities, and give users control over what meeting information they share.

## Screenshots

<!-- Add your screenshots to the repository, for example in docs/images/. -->

<p align="center">
  IMAGE
</p>

<p align="center">
  <em>Meeting room — video, collaboration, and meeting controls.</em>
</p>

<table>
  <tr>
    <td width="50%">
      <img width="1913" height="934" alt="Image" src="https://github.com/user-attachments/assets/169055b2-5203-4c7a-825f-00b395ef2971" />
    </td>
    <td width="50%">
      <img width="1910" height="936" alt="Image" src="https://github.com/user-attachments/assets/21199252-80ba-4847-9ee3-7a9aeb5b4aa7" />
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img width="1906" height="934" alt="Image" src="https://github.com/user-attachments/assets/fdc0d294-6133-483c-84eb-948024fcc7a6" />
    </td>
    <td width="50%">
      <img width="1901" height="935" alt="Image" src="https://github.com/user-attachments/assets/42fde79f-b553-45b7-9428-654fbc51498a" />
    </td>
  </tr>
</table>

**Screenshot setup:** Create `docs/images/` in your repository and upload your actual screenshots using the filenames above. Remove any image entry for a feature you haven't captured or implemented.

## Features

### Real-Time Communication

- Browser-based video and audio meetings.
- Shareable meeting links with 128-bit room IDs.
- Microphone and camera controls.
- Screen sharing and in-call chat.
- Full-mesh WebRTC connections for up to four participants.
- No user account required to join a room.

### Local AI & Meeting Intelligence

- **Speech-to-text:** Browser-based Whisper inference using a Web Worker.
- **Meeting notes:** Participants can choose to share their own transcript lines, creating combined notes with participant names.
- **AI meeting assistant:** Optional summaries, action items, and follow-up questions through a locally running Ollama model.
- **Translation:** Optional local-model translation of meeting notes.
- **Privacy-conscious processing:** The optional AI features are designed to use local models rather than cloud AI APIs.

### User Experience

- Browser-based background blur and plain-background effects.
- Responsive layouts for desktop, tablet, and mobile screen sizes.
- Keyboard shortcuts, including `?` for meeting shortcuts.
- Installable Progressive Web App (PWA).
- Downloadable meeting notes in `.txt` and `.md` formats.

> **Important:** Some AI and browser features have not been fully validated on physical devices and all supported browsers. Review [What's Not Tested](#limitations-and-testing) before relying on them.

## Architecture

MeetLocal separates the meeting interface, real-time signaling, and shared message protocol into an npm workspaces monorepo.

```text
MeetLocal/
├── apps/
│   ├── web/                 # React UI and WebRTC client
│   └── signaling/           # Node.js WebSocket signaling server
├── packages/
│   └── shared/              # Shared message protocol and Zod schemas
├── docs/                    # Architecture, privacy, setup and testing
├── scripts/                 # Python and Playwright E2E tests
├── package.json
└── README.md
```

### Technology Stack

| Area | Technologies |
|---|---|
| Frontend | React, TypeScript, Vite |
| Real-time communication | WebRTC, `getUserMedia`, `getDisplayMedia` |
| Signaling | Node.js, WebSocket (`ws`) |
| Shared protocol | TypeScript, Zod |
| Local speech recognition | Whisper, Web Workers, ONNX Runtime |
| Local AI assistant | Ollama, locally running LLMs |
| Computer vision | MediaPipe, browser-based segmentation |
| Testing | Unit tests, Chromium browser tests, Python, Playwright |
| Deployment | Render, static frontend and Node.js signaling service |

### How Meetings Work

```text
Participant A                         Participant B
     │                                      │
     ├────────── Join meeting link ─────────┤
     │                                      │
     ├────── WebSocket signaling ───────────┤
     │          (setup messages)            │
     │                                      │
     ├════════ Direct WebRTC media ═════════┤
     │          Audio and video              │
     │                                      │
     └────────── Collaboration ─────────────┘
                 Chat and shared notes
```

The signaling server helps browsers exchange connection setup information, including WebRTC offers, answers, and ICE candidates. When a direct peer connection is established, audio and video travel between participants without passing through an application media server.

MeetLocal uses a full-mesh connection model, so the current participant limit is four. Larger meetings would require a different media architecture.

For more details, see the [WebRTC Flow](https://github.com/BuildBySaurabh/MeetLocal/blob/main/docs/WEBRTC_FLOW.md) and [Architecture](https://github.com/BuildBySaurabh/MeetLocal/blob/main/docs/ARCHITECTURE.md) documentation.

## Privacy & Security

Privacy is a design goal, not a claim that every part of the system is risk-free.

- **Direct media:** Audio and video can travel directly between browsers when peer connectivity succeeds.
- **Minimal signaling:** The server handles room membership and connection setup rather than processing media streams.
- **Local AI:** Whisper and optional Ollama features are designed to run on the user's device.
- **User-controlled notes:** Participants choose whether to share their own transcript lines.
- **No account requirement:** Participants can join using a meeting link.

### What the Server Can See

The signaling server processes room membership and WebRTC setup messages. It also relays in-call chat and any meeting-note lines users choose to share. These are held in server memory according to the current implementation; they are not intended to be stored as persistent meeting records.

STUN services may observe network addresses. If a TURN relay is configured, encrypted media may pass through that relay.

**Local AI does not mean every part of the meeting is local.** Shared chat, shared notes, signaling, and network metadata still involve external infrastructure. Review the [Privacy & Security documentation](https://github.com/BuildBySaurabh/MeetLocal/blob/main/docs/PRIVACY_AND_SECURITY.md) before using MeetLocal for sensitive conversations.

## Getting Started

### Prerequisites

- Node.js `22.12` or newer.
- npm.
- A modern browser with WebRTC support.
- A working microphone and camera for audio/video meetings.

Optional local AI features require additional setup.

### 1. Clone the Repository

```bash
git clone https://github.com/BuildBySaurabh/MeetLocal.git
cd MeetLocal
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Start the Development Environment

```bash
npm run dev
```

The development environment starts the signaling server on port `8787` and the web application on port `5173`.

Open [http://localhost:5173](http://localhost:5173), create a meeting, and open the meeting link in a second browser tab to test both sides.

### 4. Useful Commands

```bash
npm run lint
npm test
npm run build
npm run check
```

These commands support linting, tests, production builds, and project checks as configured in the repository.

If you need to configure ports, allowed origins, or STUN/TURN servers, copy `.env.example` to `.env` if that file is present in your checkout. Otherwise, follow the environment-variable instructions in the project documentation.

## Optional Local AI Setup

AI features are optional. Normal video meetings do not require Ollama or a speech-recognition model.

### Speech-to-Text

MeetLocal uses Whisper in a browser Web Worker to transcribe the participant's own microphone audio. The model is downloaded in the browser when transcription is enabled.

### Ollama Assistant and Translation

1. Install [Ollama](https://ollama.com/).
2. Download the model:

   ```bash
   ollama pull llama3.2
   ```

3. Start Ollama and enable the assistant or translation feature in MeetLocal.

The browser communicates with Ollama on the same computer through `http://localhost:11434`.

For a hosted website, Ollama must allow requests from that website's origin. For example, in Windows Command Prompt:

```cmd
setx OLLAMA_ORIGINS "https://your-site.onrender.com"
```

Restart Ollama after changing the environment variable.

**Security note:** Only allow trusted website origins. Do not use an unrestricted origin configuration for a publicly accessible application. Browser permissions, local service access, and model availability can affect whether the feature works.

For detailed instructions, see [Local AI Setup](https://github.com/BuildBySaurabh/MeetLocal/blob/main/docs/LOCAL_AI.md).

## Deployment

The repository includes a `render.yaml` configuration intended to deploy the application as two services:

1. **Web frontend:** A Render Static Site.
2. **Signaling backend:** A Render Web Service running Node.js.

After deployment, configure the following environment variables with your actual service URLs:

| Service | Variable | Example |
|---|---|---|
| Signaling backend | `ALLOWED_ORIGINS` | `https://your-frontend.onrender.com` |
| Web frontend | `VITE_SIGNALING_URL` | `wss://your-signaling-service.onrender.com` |

The `VITE_SIGNALING_URL` value is used by the frontend build, so redeploy the frontend after changing it.

### Deployment Considerations

- Free-tier signaling services may sleep when idle, increasing the first connection's startup time.
- Meeting rooms are held in memory, so a signaling-server restart can end active meetings.
- Without a TURN server, some networks may be unable to establish peer connections.
- Browser microphone, camera, and screen-sharing APIs generally require a secure context such as HTTPS.
- Hosted local-AI features still require Ollama to be available on each participant's own computer.

See the [Deployment Guide](https://github.com/BuildBySaurabh/MeetLocal/blob/main/docs/DEPLOYMENT.md) for complete instructions.

## Limitations & Testing

MeetLocal is a learning project and is not yet a battle-tested meeting platform.

The repository includes unit tests and Chromium browser tests that use simulated cameras and microphones. The following areas have not been fully validated:

- Real Whisper, Ollama, face-detection, and segmentation models running end to end in the test environment.
- Meetings across separate physical devices.
- Real mobile phones and tablets.
- Firefox and Safari compatibility.
- TURN-server behavior and restrictive network environments.
- Accessibility testing with screen readers.

Do not rely on MeetLocal as a production-grade platform for sensitive or business-critical meetings without further testing, security review, and operational improvements.

If you encounter a bug, please open an issue in the repository with steps to reproduce it.

## Documentation

| Document | Description |
|---|---|
| [Architecture](https://github.com/BuildBySaurabh/MeetLocal/blob/main/docs/ARCHITECTURE.md) | Application structure and system design |
| [WebRTC Flow](https://github.com/BuildBySaurabh/MeetLocal/blob/main/docs/WEBRTC_FLOW.md) | Signaling and peer connections |
| [Project Structure](https://github.com/BuildBySaurabh/MeetLocal/blob/main/docs/PROJECT_STRUCTURE.md) | Repository organization |
| [Development Setup](https://github.com/BuildBySaurabh/MeetLocal/blob/main/docs/DEVELOPMENT_SETUP.md) | Local development instructions |
| [Testing](https://github.com/BuildBySaurabh/MeetLocal/blob/main/docs/TESTING.md) | Testing strategy and commands |
| [Deployment](https://github.com/BuildBySaurabh/MeetLocal/blob/main/docs/DEPLOYMENT.md) | Render deployment |
| [Local AI](https://github.com/BuildBySaurabh/MeetLocal/blob/main/docs/LOCAL_AI.md) | Whisper and Ollama setup |
| [Privacy & Security](https://github.com/BuildBySaurabh/MeetLocal/blob/main/docs/PRIVACY_AND_SECURITY.md) | Data flows and privacy considerations |
| [Project Status](https://github.com/BuildBySaurabh/MeetLocal/blob/main/docs/PROJECT_STATUS.md) | Current implementation status |

The end-to-end testing scripts require Python and Playwright:

```bash
pip install -r requirements.txt
```

Python is used for testing tools; the meeting application itself is built with TypeScript and Node.js.

## Future Improvements

Potential next steps for the project include:

- Validate local AI features end to end with real models.
- Improve connectivity using a properly configured TURN service.
- Expand cross-browser and physical-device testing.
- Improve accessibility and keyboard navigation.
- Strengthen production observability, reliability, and security testing.
- Evaluate a scalable media architecture if meetings need to support more participants.

## About the Project

MeetLocal is an independent learning project exploring privacy-first communication, browser-based AI, and real-time web technologies.

Built by **Saurabh Waghmare**.

<p align="center">
  <a href="https://github.com/BuildBySaurabh">GitHub</a> ·
  <a href="https://portfolio-j3ox.onrender.com">Portfolio</a> ·
  <a href="https://www.linkedin.com/in/saurabh-waghamre-3a4412245">LinkedIn</a>
</p>

---

<p align="center">
  <sub>Built to learn, experiment, and explore a more privacy-conscious approach to online meetings.</sub>
</p>
