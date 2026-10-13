import { describe, expect, it } from 'vitest';
import { createMeeting, getShareUrl, isValidRoomId, parseMeetingInput } from './room.service';

const ID = 'AbCdEfGhIjKlMnOpQrSt_-';

describe('parseMeetingInput', () => {
  it('accepts a bare meeting ID', () => {
    expect(parseMeetingInput(ID)).toBe(ID);
    expect(parseMeetingInput(`  ${ID}  `)).toBe(ID);
  });

  it('extracts the ID from join and meeting links', () => {
    expect(parseMeetingInput(`https://meet.example.com/join/${ID}`)).toBe(ID);
    expect(parseMeetingInput(`http://localhost:5173/join/${ID}/`)).toBe(ID);
    expect(parseMeetingInput(`https://meet.example.com/meeting/${ID}`)).toBe(ID);
    expect(parseMeetingInput(`https://meet.example.com/join/${ID}?utm=x#frag`)).toBe(ID);
  });

  it.each([
    ['empty input', ''],
    ['whitespace', '   '],
    ['random text', 'hello world'],
    ['too-short ID', 'abc123'],
    ['too-long ID', ID + 'x'],
    ['link without an ID', 'https://meet.example.com/join/'],
    ['link with the wrong path', `https://meet.example.com/other/${ID}`],
    ['link with an invalid ID', 'https://meet.example.com/join/not-a-valid-id'],
    ['non-http scheme', `javascript:alert(1)//join/${ID}`],
    ['ftp link', `ftp://meet.example.com/join/${ID}`],
  ])('rejects %s', (_label, input) => {
    expect(parseMeetingInput(input)).toBeNull();
  });
});

describe('createMeeting', () => {
  it('generates valid, unique, unguessable-length room IDs', () => {
    const ids = new Set(Array.from({ length: 200 }, () => createMeeting('https://x.test').roomId));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(isValidRoomId(id)).toBe(true);
  });

  it('builds a URL that parses back to the same ID', () => {
    const { roomId, url } = createMeeting('https://meet.example.com/');
    expect(url).toBe(`https://meet.example.com/join/${roomId}`);
    expect(parseMeetingInput(url)).toBe(roomId);
    expect(getShareUrl(roomId, 'https://meet.example.com')).toBe(url);
  });
});
