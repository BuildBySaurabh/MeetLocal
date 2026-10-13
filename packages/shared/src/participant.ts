import { z } from 'zod';

/** Random, client-generated identifier. 16-64 URL-safe characters. */
export const PARTICIPANT_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export const DISPLAY_NAME_MAX_LENGTH = 40;

export const participantIdSchema = z.string().regex(PARTICIPANT_ID_PATTERN, 'Invalid participant id');

/**
 * Display names are untrusted text. Control characters are rejected here; the UI must still
 * render the name as text (React escapes by default) and never as HTML.
 */
export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Display name is required')
  .max(DISPLAY_NAME_MAX_LENGTH)
  // eslint-disable-next-line no-control-regex
  .regex(/^[^\u0000-\u001f\u007f]+$/, 'Display name contains control characters');

export const participantSchema = z.object({
  id: participantIdSchema,
  displayName: displayNameSchema,
});

export type Participant = z.infer<typeof participantSchema>;

/** Generates a random participant id (128 bits of randomness, base64url). */
export function generateParticipantId(): string {
  return randomBase64Url(16);
}

export function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
