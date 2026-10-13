import { buildMeetingUrl, generateRoomId, isValidRoomId, parseMeetingInput } from '@meetlocal/shared';

export { isValidRoomId, parseMeetingInput };

/** Creates a new unguessable meeting ID (128 bits of randomness) and its shareable URL. */
export function createMeeting(origin: string = window.location.origin): { roomId: string; url: string } {
  const roomId = generateRoomId();
  return { roomId, url: buildMeetingUrl(origin, roomId) };
}

export function getShareUrl(roomId: string, origin: string = window.location.origin): string {
  return buildMeetingUrl(origin, roomId);
}
