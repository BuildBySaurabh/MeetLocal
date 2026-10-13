import { describe, expect, it } from 'vitest';
import type { NoteEntry } from '../rooms/meetingSession';
import { escapeMd, formatNotesMarkdown, formatNotesText } from './notesFormat';

const note = (id: string, who: string, text: string, at: number, speakerId = who.toLowerCase()): NoteEntry => ({
  id,
  speakerId,
  speakerName: who,
  text,
  at,
  own: false,
});
const opts = { formatTime: (ms: number) => `t${ms}`, formatDate: () => '2026-10-13' };

describe('formatNotesText', () => {
  it('lists lines by time with the speaker name, whatever the arrival order', () => {
    const out = formatNotesText([note('2', 'Bob', 'second', 20), note('1', 'Alice', 'first', 10)], opts);
    expect(out).toBe('MeetLocal meeting notes\n2026-10-13\n\n[t10] Alice: first\n[t20] Bob: second\n');
  });

  it('includes translations under the original line', () => {
    const out = formatNotesText([note('1', 'Alice', 'hello', 10)], {
      ...opts,
      translations: new Map([['1', 'hola']]),
      translationLanguage: 'Spanish',
    });
    expect(out).toContain('[t10] Alice: hello\n    (Spanish) hola');
  });

  it('handles an empty meeting', () => {
    expect(formatNotesText([], opts)).toBe('MeetLocal meeting notes\n\n');
  });
});

describe('formatNotesMarkdown', () => {
  it('groups consecutive lines by the same speaker and lists speakers', () => {
    const out = formatNotesMarkdown(
      [note('1', 'Alice', 'one', 10), note('2', 'Alice', 'two', 11), note('3', 'Bob', 'three', 12)],
      opts,
    );
    expect(out).toContain('# MeetLocal meeting notes');
    expect(out).toContain('**Speakers:** Alice, Bob');
    expect(out.match(/\*\*Alice\*\* · /g)).toHaveLength(1);
    expect(out).toContain('**Bob** · t12');
    expect(out.endsWith('three\n')).toBe(true);
  });

  it('keeps two people with the same name apart', () => {
    const out = formatNotesMarkdown([note('1', 'Sam', 'a', 1, 'id1'), note('2', 'Sam', 'b', 2, 'id2')], opts);
    expect(out.match(/\*\*Sam\*\* · /g)).toHaveLength(2);
  });

  it('escapes Markdown and HTML in spoken text and names', () => {
    expect(escapeMd('# hi <script> *x* [a](b)\nnext')).toBe('\\# hi \\<script\\> \\*x\\* \\[a\\](b) next');
    const out = formatNotesMarkdown([note('1', '*Eve*', '# heading', 1)], opts);
    expect(out).toContain('**\\*Eve\\***');
    expect(out).toContain('\\# heading');
  });
});
