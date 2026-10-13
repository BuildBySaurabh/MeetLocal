import { loadConfig } from './config.js';
import { createSignalingServer } from './server.js';

const config = loadConfig();
const server = createSignalingServer(config);

const port = await server.listen();
console.log(`[signaling] listening on ${config.host}:${port} (${config.production ? 'production' : 'development'})`);
console.log(`[signaling] allowed origins: ${config.allowedOrigins.join(', ') || '(any, development only)'}`);
console.log('[signaling] rooms are in-memory and are lost on restart');

async function shutdown(signal: string): Promise<void> {
  console.log(`[signaling] ${signal} received, shutting down`);
  await server.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
