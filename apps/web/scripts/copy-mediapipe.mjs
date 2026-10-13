// Copies MediaPipe's WebAssembly runtime next to the app so it is served from this origin, not a CDN.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
// The package's exports do not expose package.json, so locate it through the main file.
const source = join(dirname(require.resolve('@mediapipe/tasks-vision')), 'wasm');
if (!existsSync(source)) throw new Error(`Missing ${source}. Run npm install.`);
const target = join(here, '..', 'public', 'mediapipe', 'wasm');
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
console.log('Copied MediaPipe WebAssembly files to public/mediapipe/wasm');
