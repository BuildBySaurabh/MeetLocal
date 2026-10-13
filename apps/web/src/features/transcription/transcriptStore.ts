import type { TranscriptSegment } from './transcription.types';

/** Where transcripts live. Always on this device: never the signaling server, never a cloud service. */
export interface TranscriptStore {
  list(meetingId: string): Promise<TranscriptSegment[]>;
  add(meetingId: string, segment: TranscriptSegment): Promise<void>;
  clearMeeting(meetingId: string): Promise<void>;
  clearAll(): Promise<void>;
}

export function createMemoryStore(): TranscriptStore {
  const data = new Map<string, TranscriptSegment[]>();
  return {
    async list(meetingId) {
      return [...(data.get(meetingId) ?? [])].sort((a, b) => a.startedAt - b.startedAt);
    },
    async add(meetingId, segment) {
      data.set(meetingId, [...(data.get(meetingId) ?? []), segment]);
    },
    async clearMeeting(meetingId) {
      data.delete(meetingId);
    },
    async clearAll() {
      data.clear();
    },
  };
}

const DB_NAME = 'meetlocal-transcripts';
const STORE = 'segments';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

interface StoredSegment extends TranscriptSegment {
  meetingId: string;
}

/** IndexedDB-backed store (stays in this browser profile; not encrypted). */
export function createIndexedDbStore(factory: IDBFactory = indexedDB): TranscriptStore {
  let dbPromise: Promise<IDBDatabase> | null = null;
  function open(): Promise<IDBDatabase> {
    dbPromise ??= new Promise((resolve, reject) => {
      const req = factory.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('meetingId', 'meetingId');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Could not open IndexedDB'));
    });
    return dbPromise;
  }
  return {
    async list(meetingId) {
      const db = await open();
      const rows = await request<StoredSegment[]>(
        db.transaction(STORE).objectStore(STORE).index('meetingId').getAll(meetingId),
      );
      return rows.sort((a, b) => a.startedAt - b.startedAt).map(({ meetingId: _unused, ...segment }) => segment);
    },
    async add(meetingId, segment) {
      const db = await open();
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ ...segment, meetingId });
      await done(tx);
    },
    async clearMeeting(meetingId) {
      const db = await open();
      const tx = db.transaction(STORE, 'readwrite');
      const index = tx.objectStore(STORE).index('meetingId');
      const keys = await request(index.getAllKeys(meetingId));
      for (const key of keys) tx.objectStore(STORE).delete(key);
      await done(tx);
    },
    async clearAll() {
      const db = await open();
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      await done(tx);
    },
  };
}

/** Uses IndexedDB when available, otherwise keeps transcripts in memory for this page only. */
export function createDefaultStore(): { store: TranscriptStore; persistent: boolean } {
  if (typeof indexedDB === 'undefined') return { store: createMemoryStore(), persistent: false };
  return { store: createIndexedDbStore(), persistent: true };
}

/** Plain-text export: one line per segment with a local timestamp. */
export function formatTranscript(segments: TranscriptSegment[], title = 'MeetLocal transcript'): string {
  const lines = segments.map((s) => {
    const time = new Date(s.startedAt).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    return `[${time}] You: ${s.text}`;
  });
  return `${title}\nGenerated on this device. Speech recognition is automatic and may contain errors.\n\n${lines.join('\n')}\n`;
}
