import { parseServerMessage, type ClientMessage, type ServerMessage } from '@meetlocal/shared';
import type { EnvLike } from '../webrtc/iceManager';

/**
 * Where the signaling server lives. Defaults to port 8787 on the same host as the page so
 * that opening the app from another device on the LAN works without extra configuration.
 */
export function getSignalingUrl(env: EnvLike, location: Pick<Location, 'protocol' | 'hostname'>): string {
  const configured = env.VITE_SIGNALING_URL?.trim();
  if (configured) return configured;
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.hostname}:8787`;
}

export interface SignalingHandlers {
  onOpen(): void;
  onMessage(message: ServerMessage): void;
  /** `wasOpen` is false when the connection never succeeded (server down, origin rejected). */
  onClose(info: { code: number; wasOpen: boolean }): void;
}

/** The subset of WebSocket this client uses, so tests can substitute a fake. */
export interface SocketLike {
  readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

const OPEN = 1;

export class SignalingClient {
  private socket: SocketLike | null = null;
  private wasOpen = false;
  private closedByUs = false;

  constructor(
    private readonly url: string,
    private readonly handlers: SignalingHandlers,
    private readonly socketFactory: (url: string) => SocketLike = (u) => new WebSocket(u) as unknown as SocketLike,
  ) {}

  connect(): void {
    if (this.socket) return;
    const socket = this.socketFactory(this.url);
    this.socket = socket;

    socket.onopen = () => {
      if (this.closedByUs) return;
      this.wasOpen = true;
      this.handlers.onOpen();
    };
    socket.onmessage = (event) => {
      if (this.closedByUs || typeof event.data !== 'string') return;
      const parsed = parseServerMessage(event.data);
      if (!parsed.ok) {
        console.warn('Ignoring invalid message from signaling server');
        return;
      }
      this.handlers.onMessage(parsed.value);
    };
    socket.onclose = (event) => {
      if (this.closedByUs) return;
      this.handlers.onClose({ code: event.code, wasOpen: this.wasOpen });
    };
    socket.onerror = () => {
      // A close event always follows; it is handled in onclose.
    };
  }

  /** Returns false if the message could not be sent because the socket is not open. */
  send(message: ClientMessage): boolean {
    if (!this.socket || this.socket.readyState !== OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  /** Closes the connection and stops all further handler callbacks. */
  close(): void {
    this.closedByUs = true;
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    try {
      socket.close(1000, 'client closing');
    } catch (error) {
      console.warn('Error while closing signaling socket', error);
    }
  }
}
