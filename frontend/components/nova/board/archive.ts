/**
 * Saves each class's board — pages, diagrams, research, and the generated
 * images and clips — so a previous chat can be reopened exactly as it was.
 *
 * IndexedDB rather than localStorage: a single class can carry several MB of
 * pictures, far past localStorage's ~5 MB total.
 */

const DB = 'agent-acharya';
const STORE = 'archive';

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) {
  const db = await open();
  return new Promise<T>((res, rej) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export type SavedMedia = { blob: Blob; mime: string; source?: string };

export async function saveBoard(chatId: string, data: unknown) {
  try {
    await run('readwrite', (s) => s.put(data, `board:${chatId}`));
  } catch {
    /* archive is best-effort */
  }
}

export async function loadBoard<T>(chatId: string): Promise<T | undefined> {
  try {
    return await run<T>('readonly', (s) => s.get(`board:${chatId}`) as IDBRequest<T>);
  } catch {
    return undefined;
  }
}

export async function saveMedia(chatId: string, id: string, media: SavedMedia) {
  try {
    await run('readwrite', (s) => s.put(media, `media:${chatId}:${id}`));
  } catch {
    /* archive is best-effort */
  }
}

export async function loadMedia(chatId: string): Promise<Record<string, SavedMedia>> {
  try {
    const range = IDBKeyRange.bound(`media:${chatId}:`, `media:${chatId}:￿`);
    const [keys, values] = await Promise.all([
      run<IDBValidKey[]>('readonly', (s) => s.getAllKeys(range)),
      run<SavedMedia[]>('readonly', (s) => s.getAll(range) as IDBRequest<SavedMedia[]>),
    ]);
    const out: Record<string, SavedMedia> = {};
    keys.forEach((k, i) => (out[String(k).split(':').slice(2).join(':')] = values[i]));
    return out;
  } catch {
    return {};
  }
}

export async function clearArchive() {
  try {
    await run('readwrite', (s) => s.clear());
  } catch {
    /* ignore */
  }
}
