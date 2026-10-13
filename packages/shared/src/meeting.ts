import { randomBase64Url } from './participant.js';

/** 16 random bytes (128 bits) encoded as 22 base64url characters. */
export const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** Group calls are a full mesh (each participant sends media to every other), so keep this small. */
export const MAX_PARTICIPANTS_PER_ROOM = 4;

export function generateRoomId(): string {
  return randomBase64Url(16);
}

export function isValidRoomId(value: string): boolean {
  return ROOM_ID_PATTERN.test(value);
}

/** Builds the shareable URL for a meeting, e.g. https://host/join/<roomId>. */
export function buildMeetingUrl(origin: string, roomId: string): string {
  return `${origin.replace(/\/+$/, '')}/join/${roomId}`;
}

/**
 * Accepts either a bare meeting ID or a pasted meeting link and returns the room ID,
 * or null when the input is not a valid MeetLocal meeting reference.
 */
export function parseMeetingInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (isValidRoomId(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const match = /^\/(?:join|meeting)\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
  const candidate = match?.[1];
  return candidate && isValidRoomId(candidate) ? candidate : null;
}
