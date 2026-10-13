import { describe, expect, it, vi } from 'vitest';
import { getIceServers } from '../webrtc/iceManager';
import { SignalingClient, getSignalingUrl, type SocketLike } from './signalingClient';

class FakeSocket implements SocketLike {
  readyState = 0;
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  sent: string[] = [];
  closed = false;
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
}

function setup() {
  const socket = new FakeSocket();
  const handlers = { onOpen: vi.fn(), onMessage: vi.fn(), onClose: vi.fn() };
  const client = new SignalingClient('ws://test', handlers, () => socket);
  client.connect();
  return { socket, handlers, client };
}

describe('SignalingClient', () => {
  it('reports open and delivers validated server messages', () => {
    const { socket, handlers } = setup();
    socket.open();
    expect(handlers.onOpen).toHaveBeenCalled();
    socket.onmessage?.({ data: JSON.stringify({ type: 'error', code: 'room-full', message: 'x' }) });
    expect(handlers.onMessage).toHaveBeenCalledWith({ type: 'error', code: 'room-full', message: 'x' });
  });

  it('ignores invalid and non-text messages', () => {
    const { socket, handlers } = setup();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    socket.open();
    socket.onmessage?.({ data: '{bad' });
    socket.onmessage?.({ data: JSON.stringify({ type: 'nope' }) });
    socket.onmessage?.({ data: new ArrayBuffer(4) });
    expect(handlers.onMessage).not.toHaveBeenCalled();
  });

  it('refuses to send until the socket is open', () => {
    const { socket, client } = setup();
    expect(client.send({ type: 'leave' })).toBe(false);
    socket.open();
    expect(client.send({ type: 'leave' })).toBe(true);
    expect(socket.sent).toEqual([JSON.stringify({ type: 'leave' })]);
  });

  it('tells the caller whether the connection ever opened when it closes', () => {
    const never = setup();
    never.socket.onclose?.({ code: 1006 });
    expect(never.handlers.onClose).toHaveBeenCalledWith({ code: 1006, wasOpen: false });

    const opened = setup();
    opened.socket.open();
    opened.socket.onclose?.({ code: 1001 });
    expect(opened.handlers.onClose).toHaveBeenCalledWith({ code: 1001, wasOpen: true });
  });

  it('stops all callbacks after close()', () => {
    const { socket, handlers, client } = setup();
    socket.open();
    client.close();
    expect(socket.closed).toBe(true);
    expect(socket.onmessage).toBeNull();
    expect(client.send({ type: 'leave' })).toBe(false);
    expect(() => client.close()).not.toThrow();
    expect(handlers.onClose).not.toHaveBeenCalled();
  });
});

describe('getSignalingUrl', () => {
  it('prefers the configured URL', () => {
    expect(getSignalingUrl({ VITE_SIGNALING_URL: 'wss://sig.example' }, { protocol: 'http:', hostname: 'x' })).toBe(
      'wss://sig.example',
    );
  });

  it('defaults to port 8787 on the page host with a matching scheme', () => {
    expect(getSignalingUrl({}, { protocol: 'http:', hostname: '192.168.1.5' })).toBe('ws://192.168.1.5:8787');
    expect(getSignalingUrl({}, { protocol: 'https:', hostname: 'meet.example' })).toBe('wss://meet.example:8787');
  });
});

describe('getIceServers', () => {
  it('uses a STUN server and no TURN by default', () => {
    const servers = getIceServers({});
    expect(servers).toHaveLength(1);
    expect(JSON.stringify(servers)).not.toContain('turn:');
  });

  it('reads multiple STUN URLs and an optional TURN relay', () => {
    const servers = getIceServers({
      VITE_STUN_URLS: 'stun:a.example:3478, stun:b.example:3478',
      VITE_TURN_URL: 'turn:t.example:3478',
      VITE_TURN_USERNAME: 'u',
      VITE_TURN_CREDENTIAL: 'c',
    });
    expect(servers[0]).toEqual({ urls: ['stun:a.example:3478', 'stun:b.example:3478'] });
    expect(servers[1]).toEqual({ urls: 'turn:t.example:3478', username: 'u', credential: 'c' });
  });
});
