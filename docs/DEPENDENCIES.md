# Dependencies and licences (reviewed 2026-10-13)

Production dependency tree: 64 packages. Licences: MIT 33, BSD-3-Clause 11, Apache-2.0 9, ISC 3, 0BSD 1,
(MIT OR CC0-1.0) 1, and 3 workspace packages with no licence field (set one before publishing).

- **LGPL-3.0-or-later**: `@img/sharp-libvips-*` (and `@img/sharp-wasm32`, Apache-2.0 AND LGPL-3.0-or-later AND MIT) are pulled in
  transitively by `@huggingface/transformers`. They are image-processing binaries not used by the browser bundle; check
  that your distribution does not ship them if LGPL is a concern.
- **Models**: Whisper (MIT); MediaPipe Face Landmarker (Apache-2.0); LLMs run through Ollama have their own licences.
- `npm audit`: 0 vulnerabilities. `npm outdated`: only new major versions (eslint 10, typescript 7, zod 4, ...); not upgraded
  deliberately in this phase.
- Install note: `onnxruntime-node` has a postinstall download that fails on restricted networks; the browser app does not use it (`--ignore-scripts`).
- Re-run `npm audit` before each release.
