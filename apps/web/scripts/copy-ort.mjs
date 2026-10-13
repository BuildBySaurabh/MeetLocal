// Copies the ONNX Runtime WebAssembly files next to the app so the speech model's runtime is served
// from this origin instead of a public CDN (no third party sees that you opened transcription).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
// The package does not export package.json, so locate it through an exported file.
const source = dirname(dirname(require.resolve('onnxruntime-web')));
const target = join(here, '..', 'public', 'ort');
mkdirSync(target, { recursive: true });
for (const file of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  const from = join(source, 'dist', file);
  if (!existsSync(from)) throw new Error(`Missing ${from}. Run npm install.`);
  copyFileSync(from, join(target, file));
}
console.log('Copied ONNX Runtime WebAssembly files to public/ort');
