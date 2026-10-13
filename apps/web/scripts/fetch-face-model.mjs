// Explicit, one-time download of the face model into apps/web/public/models/.
// MeetLocal never fetches this file by itself at run time. Run: npm run fetch:face-model
//
// Source:   Google's MediaPipe model storage (Face Landmarker, float16).
// Licence:  Apache License 2.0 (MediaPipe). See https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker
// Privacy:  this download is made by this script, from your machine, to storage.googleapis.com.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_ = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'public', 'models', 'face_landmarker.task');

console.log(`Downloading ${URL_}`);
const response = await fetch(URL_);
if (!response.ok) {
  console.error(`Download failed: HTTP ${response.status}. You can download the file yourself and place it at ${target}`);
  process.exit(1);
}
const bytes = Buffer.from(await response.arrayBuffer());
if (bytes.length < 1_000_000) {
  console.error(`Unexpected file size (${bytes.length} bytes); not saving.`);
  process.exit(1);
}
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, bytes);
console.log(`Saved ${bytes.length} bytes to ${target}`);
