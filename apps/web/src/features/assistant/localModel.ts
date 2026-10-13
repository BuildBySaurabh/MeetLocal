/** Adapter for a language model running on this computer (Ollama's HTTP API). Never contacts a cloud service. */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LocalModelConfig {
  endpoint: string;
  model: string;
}

export const DEFAULT_ENDPOINT = 'http://localhost:11434';
export const DEFAULT_MODEL = 'llama3.2';

export function getLocalModelConfig(env: { VITE_OLLAMA_URL?: string; VITE_OLLAMA_MODEL?: string }): LocalModelConfig {
  return { endpoint: env.VITE_OLLAMA_URL || DEFAULT_ENDPOINT, model: env.VITE_OLLAMA_MODEL || DEFAULT_MODEL };
}

/**
 * Only endpoints on this computer are allowed (localhost, 127.x.x.x, ::1). This is a guard against a
 * misconfiguration quietly sending meeting text to another machine or a cloud API.
 */
export function isLocalEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host === '::1' || /^127(\.\d{1,3}){3}$/.test(host);
}

export type Availability =
  { kind: 'blocked-endpoint' } | { kind: 'unavailable'; detail: string } | { kind: 'reachable'; models: string[] };

export interface LocalModelClient {
  checkAvailability(signal?: AbortSignal): Promise<Availability>;
  /** Streams the reply; `onToken` receives each new piece of text. Resolves when the model finishes. */
  chat(model: string, messages: ChatMessage[], onToken: (text: string) => void, signal?: AbortSignal): Promise<void>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class LocalModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalModelError';
  }
}

export function createOllamaClient(
  endpoint: string,
  fetchImpl: FetchLike = (i, init) => fetch(i, init),
): LocalModelClient {
  const base = endpoint.replace(/\/+$/, '');
  return {
    async checkAvailability(signal) {
      if (!isLocalEndpoint(endpoint)) return { kind: 'blocked-endpoint' };
      try {
        const response = await fetchImpl(`${base}/api/tags`, { signal });
        if (!response.ok) return { kind: 'unavailable', detail: `The server answered with status ${response.status}.` };
        const body = (await response.json()) as { models?: Array<{ name?: unknown }> };
        const models = (body.models ?? []).map((m) => m.name).filter((n): n is string => typeof n === 'string');
        return { kind: 'reachable', models };
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        return { kind: 'unavailable', detail: 'Could not connect.' };
      }
    },

    async chat(model, messages, onToken, signal) {
      if (!isLocalEndpoint(endpoint)) throw new LocalModelError('The model endpoint is not on this computer.');
      let response: Response;
      try {
        response = await fetchImpl(`${base}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages, stream: true }),
          signal,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        throw new LocalModelError('Lost the connection to the local model.');
      }
      if (!response.ok || !response.body) {
        const detail = await response.text().catch(() => '');
        throw new LocalModelError(
          parseError(detail) ?? `The local model server answered with status ${response.status}.`,
        );
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          handleLine(buffer.slice(0, newline), onToken);
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf('\n');
        }
      }
      handleLine(buffer, onToken);
    },
  };
}

function parseError(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    return typeof parsed.error === 'string' ? parsed.error : null;
  } catch {
    return null;
  }
}

function handleLine(line: string, onToken: (text: string) => void): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  let parsed: { message?: { content?: unknown }; error?: unknown };
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (typeof parsed.error === 'string') throw new LocalModelError(parsed.error);
  const content = parsed.message?.content;
  if (typeof content === 'string' && content) onToken(content);
}
