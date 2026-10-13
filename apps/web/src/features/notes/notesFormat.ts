import type { NoteEntry } from '../rooms/meetingSession';

export interface NotesFormatOptions {
  title?: string;
  /** Translated text by note id (shown under the original). */
  translations?: ReadonlyMap<string, string>;
  /** Name of the translation language, shown next to translated lines. */
  translationLanguage?: string;
  /** Injectable for tests; defaults to local time HH:MM:SS. */
  formatTime?: (ms: number) => string;
  /** Injectable for tests; defaults to the local date. */
  formatDate?: (ms: number) => string;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function defaultTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function defaultDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function sorted(notes: readonly NoteEntry[]): NoteEntry[] {
  // Array.prototype.sort is stable, so lines with the same timestamp keep their arrival order.
  return [...notes].sort((a, b) => a.at - b.at);
}

/** Plain-text notes: one line per spoken line, "[time] Name: text". */
export function formatNotesText(notes: readonly NoteEntry[], options: NotesFormatOptions = {}): string {
  const time = options.formatTime ?? defaultTime;
  const date = options.formatDate ?? defaultDate;
  const list = sorted(notes);
  const lines: string[] = [options.title ?? 'MeetLocal meeting notes'];
  if (list[0]) lines.push(date(list[0].at));
  lines.push('');
  for (const note of list) {
    lines.push(`[${time(note.at)}] ${note.speakerName}: ${note.text}`);
    const translated = options.translations?.get(note.id);
    if (translated) lines.push(`    (${options.translationLanguage ?? 'translation'}) ${translated}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Markdown notes: consecutive lines by the same person are grouped under one heading line. */
export function formatNotesMarkdown(notes: readonly NoteEntry[], options: NotesFormatOptions = {}): string {
  const time = options.formatTime ?? defaultTime;
  const date = options.formatDate ?? defaultDate;
  const list = sorted(notes);
  const out: string[] = [`# ${options.title ?? 'MeetLocal meeting notes'}`, ''];
  if (list[0]) out.push(`_${date(list[0].at)}_`, '');
  const speakers = [...new Set(list.map((n) => n.speakerName))];
  if (speakers.length) out.push(`**Speakers:** ${speakers.map(escapeMd).join(', ')}`, '');
  let previous: string | null = null;
  for (const note of list) {
    if (note.speakerId !== previous) {
      out.push(`**${escapeMd(note.speakerName)}** · ${time(note.at)}`, '');
      previous = note.speakerId;
    }
    out.push(escapeMd(note.text), '');
    const translated = options.translations?.get(note.id);
    if (translated) out.push(`> ${escapeMd(translated)}`, '');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** Stops spoken text from being interpreted as Markdown structure (headings, emphasis, links, HTML). */
export function escapeMd(text: string): string {
  return text.replace(/([\\`*_{}[\]<>#|])/g, '\\$1').replace(/\n/g, ' ');
}
