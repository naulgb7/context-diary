// 端末内の保存(IndexedDB)
// entries   : 随時の記入 {id, day, text, question, updatedAt, deleted, dirty}
// summaries : 1日のまとめ {day, answers:{問い:答え}, questions:[], pos, status, updatedAt, dirty, logged}
// kv        : 設定・同期状態など

const DB_NAME = 'context-diary';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const entries = db.createObjectStore('entries', { keyPath: 'id' });
      entries.createIndex('day', 'day');
      db.createObjectStore('summaries', { keyPath: 'day' });
      db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, mode, fn) {
  const db = await open();
  const t = db.transaction(store, mode);
  const result = await fn(t.objectStore(store));
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
  return result;
}

// ---- entries ----
export const putEntry = (e) => tx('entries', 'readwrite', (s) => wrap(s.put(e)));
export const getEntry = (id) => tx('entries', 'readonly', (s) => wrap(s.get(id)));
export const allEntries = () => tx('entries', 'readonly', (s) => wrap(s.getAll()));
export const entriesOfDay = (day) => tx('entries', 'readonly', (s) => wrap(s.index('day').getAll(day)));

// ある日の記入を、ドライブから読んだ内容で置き換える
export async function replaceDay(day, entries) {
  return tx('entries', 'readwrite', async (s) => {
    const old = await wrap(s.index('day').getAll(day));
    for (const e of old) s.delete(e.id);
    for (const e of entries) s.put(e);
  });
}

// ---- summaries ----
export const putSummary = (sm) => tx('summaries', 'readwrite', (s) => wrap(s.put(sm)));
export const getSummary = (day) => tx('summaries', 'readonly', (s) => wrap(s.get(day)));
export const allSummaries = () => tx('summaries', 'readonly', (s) => wrap(s.getAll()));
export const deleteSummary = (day) => tx('summaries', 'readwrite', (s) => wrap(s.delete(day)));

// ---- kv ----
export const kvGet = (k) => tx('kv', 'readonly', (s) => wrap(s.get(k)));
export const kvSet = (k, v) => tx('kv', 'readwrite', (s) => wrap(s.put(v, k)));
