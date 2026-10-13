import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { MAX_SIGNALING_MESSAGE_BYTES, type ServerMessage } from '@meetlocal/shared';
import type { SignalingConfig } from './config.js';
import { RoomManager } from './rooms/roomManager.js';
import { ConnectionLimiter, TokenBucket } from './security/rateLimiter.js';
import { isOriginAllowed } from './security/originValidator.js';
import { createMessageRouter, type ClientSession } from './signaling/messageRouter.js';

export interface SignalingServer {
  httpServer: Server;
  rooms: RoomManager;
  listen(): Promise<number>;
  close(): Promise<void>;
}

function clientIp(request: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = request.headers['x-forwarded-for'];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.socket.remoteAddress ?? 'unknown';
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export function createSignalingServer(config: SignalingConfig): SignalingServer {
  const rooms = new RoomManager({ maxRooms: config.maxRooms, emptyRoomTtlMs: config.emptyRoomTtlMs });
  const router = createMessageRouter(rooms);
  const connectionLimiter = new ConnectionLimiter({
    maxConcurrentPerIp: config.maxConnectionsPerIp,
    maxAttemptsPerMinute: config.maxConnectionAttemptsPerMinute,
  });

  // The HTTP server only serves a health check; everything else is a WebSocket upgrade.
  const httpServer = createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    response.writeHead(404);
    response.end();
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_SIGNALING_MESSAGE_BYTES });
  const aliveSockets = new WeakSet<WebSocket>();

  httpServer.on('upgrade', (request, socket, head) => {
    const origin = request.headers.origin;
    if (!isOriginAllowed(origin, config.allowedOrigins, config.production)) {
      rejectUpgrade(socket, 403, 'Forbidden');
      return;
    }
    const ip = clientIp(request, config.trustProxy);
    if (!connectionLimiter.tryAcquire(ip)) {
      rejectUpgrade(socket, 429, 'Too Many Requests');
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.once('close', () => connectionLimiter.release(ip));
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    const session: ClientSession = {
      handle: {
        send(message: ServerMessage) {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
        },
      },
      limiter: new TokenBucket(config.messageBurst, config.messagesPerSecond),
      chatLimiter: new TokenBucket(config.chatBurst, config.chatPerSecond),
      notesLimiter: new TokenBucket(config.notesBurst, config.notesPerSecond),
      roomId: null,
      participantId: null,
    };

    aliveSockets.add(ws);
    ws.on('pong', () => aliveSockets.add(ws));

    // Drop connections that never join a room.
    const joinTimer = setTimeout(() => {
      if (session.roomId === null) ws.close(4408, 'Join timeout');
    }, config.joinTimeoutMs);

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        session.handle.send({
          type: 'error',
          code: 'invalid-message',
          message: 'Binary messages are not supported.',
        });
        return;
      }
      router.handleMessage(session, data.toString());
    });

    ws.on('close', () => {
      clearTimeout(joinTimer);
      router.handleDisconnect(session);
    });

    // Log the error class only; never message content.
    ws.on('error', (error) => {
      console.warn(`[signaling] socket error: ${error.name}`);
    });
  });

  // Heartbeat: terminate sockets that stopped answering pings so their members are cleaned up.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!aliveSockets.has(ws)) {
        ws.terminate();
        continue;
      }
      aliveSockets.delete(ws);
      ws.ping();
    }
  }, config.heartbeatIntervalMs);

  const sweeper = setInterval(() => {
    rooms.sweep();
    connectionLimiter.prune();
  }, config.sweepIntervalMs);

  heartbeat.unref();
  sweeper.unref();

  return {
    httpServer,
    rooms,
    listen() {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(config.port, config.host, () => {
          httpServer.off('error', reject);
          const address = httpServer.address();
          resolve(typeof address === 'object' && address ? address.port : config.port);
        });
      });
    },
    close() {
      clearInterval(heartbeat);
      clearInterval(sweeper);
      return new Promise((resolve) => {
        for (const ws of wss.clients) ws.terminate();
        wss.close(() => httpServer.close(() => resolve()));
      });
    },
  };
}
