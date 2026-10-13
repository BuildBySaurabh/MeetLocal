import type { AssistantTurn } from './assistant.types';

/** Conversation history. Always on this device. */
export interface AssistantStore {
  list(meetingId: string): Promise<AssistantTurn[]>;
  put(meetingId: string, turn: AssistantTurn): Promise<void>;
  clearMeeting(meetingId: string): Promise<void>;
  clearAll(): Promise<void>;
}

export function createMemoryAssistantStore(): AssistantStore {
  const data = new Map<string, Map<string, AssistantTurn>>();
  return {
    async list(meetingId) {
      return [...(data.get(meetingId)?.values() ?? [])].sort((a, b) => a.createdAt - b.createdAt);
    },
    async put(meetingId, turn) {
      const turns = data.get(meetingId) ?? new Map<string, AssistantTurn>();
      turns.set(turn.id, turn);
      data.set(meetingId, turns);
    },
    async clearMeeting(meetingId) {
      data.delete(meetingId);
    },
    async clearAll() {
      data.clear();
    },
  };
}

const DB_NAME = 'meetlocal-assistant';
const STORE = 'turns';

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
const complete = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });

export function createIndexedDbAssistantStore(factory: IDBFactory = indexedDB): AssistantStore {
  let dbPromise: Promise<IDBDatabase> | null = null;
  const open = () =>
    (dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const r = factory.open(DB_NAME, 1);
      r.onupgradeneeded = () =>
        r.result.createObjectStore(STORE, { keyPath: 'key' }).createIndex('meetingId', 'meetingId');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error ?? new Error('Could not open IndexedDB'));
    }));
  return {
    async list(meetingId) {
      const db = await open();
      const rows = await req<Array<AssistantTurn & { key: string; meetingId: string }>>(
        db.transaction(STORE).objectStore(STORE).index('meetingId').getAll(meetingId),
      );
      return rows.sort((a, b) => a.createdAt - b.createdAt).map(({ key: _k, meetingId: _m, ...turn }) => turn);
    },
    async put(meetingId, turn) {
      const db = await open();
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ ...turn, meetingId, key: `${meetingId}:${turn.id}` });
      await complete(tx);
    },
    async clearMeeting(meetingId) {
      const db = await open();
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const keys = await req(store.index('meetingId').getAllKeys(meetingId));
      for (const key of keys) store.delete(key);
      await complete(tx);
    },
    async clearAll() {
      const db = await open();
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      await complete(tx);
    },
  };
}

export function createDefaultAssistantStore(): AssistantStore {
  return typeof indexedDB === 'undefined' ? createMemoryAssistantStore() : createIndexedDbAssistantStore();
}
