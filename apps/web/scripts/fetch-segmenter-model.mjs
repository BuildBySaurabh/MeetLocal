// Explicit, one-time download of the background (selfie segmentation) model into apps/web/public/models/.
// MeetLocal never fetches this file by itself at run time. Run: npm run fetch:segmenter-model
//
// Source:   Google's MediaPipe model storage (Selfie Segmenter, float16).
// Licence:  Apache License 2.0 (MediaPipe). See https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter
// Privacy:  this download is made by this script, from your machine, to storage.googleapis.com.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_ = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';
const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'public', 'models', 'selfie_segmenter.tflite');

console.log(`Downloading ${URL_}`);
const response = await fetch(URL_);
if (!response.ok) {
  console.error(`Download failed: HTTP ${response.status}. You can download the file yourself and place it at ${target}`);
  process.exit(1);
}
const bytes = Buffer.from(await response.arrayBuffer());
if (bytes.length < 50_000) {
  console.error(`Unexpected file size (${bytes.length} bytes); not saving.`);
  process.exit(1);
}
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, bytes);
console.log(`Saved ${bytes.length} bytes to ${target}`);
