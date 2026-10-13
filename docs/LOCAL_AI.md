# Local AI

Everything here runs on the user's own device. MeetLocal has no cloud AI fallback and never will silently gain
one: if a local model is missing, the feature says so.

## Speech recognition (Phase 4, implemented)

**Engine:** Whisper (`onnx-community/whisper-tiny.en`, 8-bit) run in the browser by
[transformers.js](https://github.com/huggingface/transformers.js) on ONNX Runtime WebAssembly, inside a Web Worker.

**Why this engine.** The brief prefers whisper.cpp or another practical local option. whisper.cpp needs a separate
native process or a custom WASM build, which would add a second install step for every user. transformers.js runs in
the page with no install. The browser's built-in `SpeechRecognition` was rejected: in Chrome it sends audio to
Google's servers, which the brief forbids. The code is behind a `TranscriptionEngine` interface
(`features/transcription/transcriptionEngine.ts`) so a whisper.cpp or larger-model adapter can replace it.

### What is captured
- Only your own microphone, only after you click **Start transcription** in the Transcript panel.
- Other participants' speech is **not** transcribed. Doing so would mean processing their audio on your device
  without their knowledge or consent; it needs an explicit consent design first. Because only you are transcribed,
  every line is labelled "You" and no speaker identification is attempted.
- While active the header shows "Transcribing on this device". **Pause** closes the audio capture entirely;
  **Stop** also unloads the model.

### Pipeline
`microphone stream -> AudioWorklet (taps audio, nothing is played or recorded) -> downsample to 16 kHz ->
energy-gate segmenter (silence 0.8 s ends an utterance, 20 s max) -> worker (Whisper) -> text -> local store`.
Interim results are not shown: the model recognises whole utterances, so lines appear shortly after you stop
speaking. If the model falls behind, the oldest waiting audio is skipped and the panel says how many stretches.

### The model download (the one network request)
- On first use the browser downloads the model files (about 40 MB) from `https://huggingface.co` and caches them
  (browser Cache API). Hugging Face can see that request (your IP, which model). The panel says this before you start.
- The ONNX Runtime WebAssembly files are copied to `public/ort/` by `apps/web/scripts/copy-ort.mjs` and served
  from MeetLocal's own origin, not a public CDN.
- To avoid Hugging Face entirely, host the model files yourself and set `VITE_TRANSCRIPTION_MODEL_HOST`
  (and optionally `VITE_TRANSCRIPTION_MODEL`). The host must serve the same path layout as Hugging Face.
- If the model cannot be downloaded the panel shows "The local speech model could not be loaded" with a retry.

### Storage
Transcript lines are stored in IndexedDB (`meetlocal-transcripts`) in this browser, per meeting ID, and are never
sent to the signaling server. **Export .txt**, **Delete transcript** (this meeting) and Settings -> **Delete saved
transcripts** (all) are provided. Browser storage is not encrypted. If IndexedDB is unavailable, lines last only
until the page closes (the panel says so).

### Limits (model-dependent; no accuracy promise)
- `whisper-tiny.en` is English only and the smallest Whisper model: expect mistakes with accents, jargon, crosstalk,
  background noise and quiet speech. Larger models are more accurate but slower and bigger downloads.
- Without cross-origin isolation, ONNX Runtime uses one thread. On slow computers recognition can lag behind
  speech; the app then skips audio and says so.
- The loudness gate is not a trained voice detector: constant noise can make utterances run long (cut at 20 s) and
  very quiet speech can be missed. Whisper sometimes outputs text for silence or noise; common markers such as
  `[BLANK_AUDIO]` are filtered, but not every hallucination is.
- WebGPU acceleration is not used yet (CPU/WASM only).

## Local assistant (Phase 5, implemented; tested only against a fake model server)

Optional panel (**Assistant** button) that sends selected transcript lines to a language model running on this
computer through [Ollama](https://ollama.com). The browser talks to Ollama directly at `http://localhost:11434`;
nothing goes through MeetLocal's servers and there is no cloud fallback.

**Setup**
1. Install Ollama and start it. 2. `ollama pull llama3.2` (about 2 GB; any chat model works; check the model's licence
for your use). 3. Allow this page to call it: set `OLLAMA_ORIGINS` to the app's origin, e.g.
`OLLAMA_ORIGINS=http://localhost:5173 ollama serve` (browsers block cross-origin requests otherwise; the panel shows
this hint). 4. Optionally set `VITE_OLLAMA_URL` / `VITE_OLLAMA_MODEL`; the model you pick in the panel is remembered.
Model weights live in Ollama's own folder, never in this repository. Hardware: a 3B model wants roughly 4 GB free RAM
and is usable on a modern CPU; larger models need more (or a GPU) and respond slowly otherwise.

**Behaviour**
- Nothing contacts Ollama until the Assistant panel is first opened. If Ollama is down, has no model, or lacks the
  configured model, the panel says exactly that, how to fix it, and the meeting is unaffected.
- **Local-only guard:** only `localhost`, `127.x.x.x` and `::1` endpoints are accepted (`isLocalEndpoint`). Any other
  address is refused before a request is made, so a misconfiguration cannot send meeting text to another machine or a
  cloud API. It does not stop someone who edits the source.
- **You choose the content:** you tick which transcript lines to share; only those are sent. Lines that arrive later
  are not shared unless ticked.
- Tasks: summarize, meeting notes, action items, follow-up questions, explain concepts, practice-answer review, study
  topics, and free questions. Each request is independent: earlier answers are not fed back in.
- **Untrusted transcript:** instructions live in the system message and task line; transcript text is quoted inside
  `<transcript>` tags, a closing tag inside the text is neutralised, and the system prompt says never to follow
  instructions found there. This reduces prompt-injection risk but cannot eliminate it for small models. The assistant
  has no tools: it cannot run commands, browse or edit files, so the worst outcome of an injected line is a misleading answer.
- **Facts vs suggestions:** the model is told to answer in two sections, "From the transcript:" and "Suggestions (not
  from the transcript):", and to say "Not stated in the transcript." when unsure. Small models do not always obey; every
  answer is labelled "Generated by <model> on this device from N selected lines. May be inaccurate."
- Answers stream in, can be stopped, and are shown as plain text. History is stored in IndexedDB (`meetlocal-assistant`)
  on this device, with **Clear assistant history** here and Settings -> delete saved transcripts and assistant history.
  History keeps your question and the answer, not a copy of the transcript text.
- Only your own speech is in the transcript, so the assistant cannot know what other participants said.

## Camera check: approximate face, head-pose and gaze feedback (Phase 6, implemented; model-dependent parts unverified)

Optional **Camera check** panel. A MediaPipe Face Landmarker model runs on this device and the page derives:
face present or not; approximate head turn (yaw), up/down tilt magnitude and sideways tilt (roll); a very rough
eye direction; whether the face touches the frame edge; and framing tips (too small, too close, off-centre, tilted).

**What it deliberately does not do**
- No claims about attention, honesty, cheating, distraction, effort or competence; the panel says so up front and
  says looking away means nothing about any of those. Tips are about camera set-up only.
- No identity recognition, no emotion recognition (blendshapes are switched off), no storage of frames or landmarks,
  no history, nothing sent to the signaling server, and other participants never see any of it.
- Off by default; turned on and off by the user; the header shows "Camera check on (only you see it)" while active.

**Setup (explicit, one-time).** The model file (`face_landmarker.task`, ~4 MB, Apache-2.0) is **not** fetched at run
time. Run `npm run fetch:face-model` to download it into `apps/web/public/models/` (git-ignored) from Google's MediaPipe
storage, or host it yourself and set `VITE_FACE_MODEL_URL`. Without it the panel says "The face model file is not
installed" with this fix. The MediaPipe WebAssembly runtime is copied from `node_modules` into `public/mediapipe/`
(served from this origin) by `apps/web/scripts/copy-mediapipe.mjs` on `npm run dev` / `build`.

**How it works.** About 4 analyses per second on a hidden video element playing your camera track; GPU delegate if
available, otherwise CPU. It runs on the main thread, not a worker: MediaPipe's WebAssembly loader inside module
workers could not be verified here, and the load is small at 4 fps. A black frame (camera switched off) is not
read as "no face": the check pauses while your camera is off.

**Accuracy and limits (read before trusting any number)**
- Head yaw/roll and eye direction come from simple geometry on 2D landmarks, not a calibrated 3D fit. They are coarse
  (tens of degrees of error are plausible), worse with glasses, beards, hair over the eyes, poor light, or when the
  head is turned far.
- **Up/down tilt:** the neutral position is a guess until you press **Calibrate** while looking at the camera; the
  up/down *direction* is not validated, so only the magnitude is shown.
- **Eye direction** is where the iris sits within the eye (relative to the head) and ignores head turn; looking "at
  the screen" is not the same as looking at the camera. Treat it as a curiosity, not a measurement.
- Phone cameras, unusual angles, or several faces (only the first is used) can give odd results.
- **None of the numbers have been checked against a real face or the real model in this project.** Only the geometry on
  synthetic landmarks and the surrounding plumbing are tested (docs/TESTING.md).

## Planned (not implemented)
- Phase 7: hardening (see docs/PROJECT_STATUS.md).

## Shared notes and translation (added after Phase 7)
- **Notes**: still your own microphone only, transcribed locally (Whisper, see above). If you switch on "Share my lines", each finished line is sent as text through the signaling server (memory only, never stored or logged) to the others, who see your name next to it. Everyone's lines are merged by time into one list kept only in the tab; download as .txt or .md before leaving. The default model `whisper-tiny.en` is English-only; for other languages set `VITE_TRANSCRIPTION_MODEL` to a multilingual Whisper model (not tested here).
- **Translation**: uses the same local Ollama as the Assistant, one note line at a time, quoted as untrusted data. Off by default and not remembered; the model server is only contacted after you pick a language. It translates text lines, not live speech audio. Quality depends on the model you run.
- **Background effects**: MediaPipe selfie segmentation (Apache-2.0) on your device. Run `npm run fetch:segmenter-model` once (about 250 KB from storage.googleapis.com, an explicit download), or set `VITE_SEGMENTER_MODEL_URL`. Blur and solid/gradient replacement are drawn on a canvas and sent as your video. The mask's polarity is checked at run time (person expected near the centre) because it could not be verified on a real person here.
