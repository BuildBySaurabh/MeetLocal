/// <reference lib="webworker" />
// Runs inside a Web Worker. transformers.js is imported lazily so it is only downloaded when the
// user turns transcription on. Nothing here talks to MeetLocal's servers.
import type { WorkerRequest, WorkerResponse } from './transcriptionEngine';

type Recognizer = (
  audio: Float32Array,
  options?: Record<string, unknown>,
) => Promise<{ text?: string } | Array<{ text?: string }>>;

let recognizer: Recognizer | null = null;
const scope = self as unknown as DedicatedWorkerGlobalScope;
const reply = (message: WorkerResponse) => scope.postMessage(message);

async function load(config: { model: string; host?: string }, wasmPath: string) {
  const { env, pipeline } = await import('@huggingface/transformers');
  // Serve the ONNX Runtime WebAssembly from this origin rather than a public CDN.
  const onnx = env.backends.onnx as { wasm?: { wasmPaths?: string } };
  if (onnx.wasm) onnx.wasm.wasmPaths = wasmPath;
  env.allowLocalModels = false;
  if (config.host) env.remoteHost = config.host.endsWith('/') ? config.host : `${config.host}/`;

  const files = new Map<string, { loaded: number; total: number }>();
  const created = await pipeline('automatic-speech-recognition', config.model, {
    device: 'wasm',
    dtype: 'q8',
    progress_callback: (info: { status?: string; file?: string; loaded?: number; total?: number }) => {
      if (info.status === 'progress' && info.file && info.total) {
        files.set(info.file, { loaded: info.loaded ?? 0, total: info.total });
        let loaded = 0;
        let total = 0;
        for (const f of files.values()) {
          loaded += f.loaded;
          total += f.total;
        }
        reply({ type: 'progress', progress: { fraction: total ? loaded / total : null, file: info.file } });
      }
    },
  } as never);
  recognizer = created as unknown as Recognizer;
}

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === 'load') {
    try {
      await load(message.config, message.wasmPath);
      reply({ type: 'ready' });
    } catch (error) {
      reply({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  } else if (message.type === 'transcribe') {
    try {
      if (!recognizer) throw new Error('Model is not loaded.');
      const result = await recognizer(message.samples);
      const text = Array.isArray(result) ? result.map((r) => r.text ?? '').join(' ') : (result.text ?? '');
      reply({ type: 'result', id: message.id, text: text.trim() });
    } catch (error) {
      reply({ type: 'error', id: message.id, message: error instanceof Error ? error.message : String(error) });
    }
  }
};
