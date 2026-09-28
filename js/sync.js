// 端末の保存とGoogleドライブの同期
import * as store from './store.js';
import * as drive from './drive.js';
import { isSignedIn, AuthError } from './auth.js';
import { buildDay, parseDay } from './markdown.js';
import { settings, adoptRemoteSettings } from './settings.js';

const MD = 'text/markdown';
const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.md$/;

let running = null;
let again = false;
const listeners = new Set();
let state = { phase: 'idle', pending: 0, message: '', lastSync: null };

export const onSyncState = (fn) => { listeners.add(fn); fn(state); };
const setState = (patch) => { state = { ...state, ...patch }; listeners.forEach((fn) => fn(state)); };

// 画面に「ドライブから新しい内容が来た」と知らせる
const dataListeners = new Set();
export const onDataChanged = (fn) => dataListeners.add(fn);
const dataChanged = () => dataListeners.forEach((fn) => fn());

// 画面に出す未送信の件数は、利用者が書いたもの(記入とまとめ)だけを数える。問いログと設定は裏で一緒に送る
export async function pendingCount() {
  const entries = (await store.allEntries()).filter((e) => e.dirty).length;
  const sums = (await store.allSummaries()).filter((s) => s.dirty).length;
  return entries + sums;
}

export async function refreshPending() {
  setState({ pending: await pendingCount() });
}

// 同期を頼む。走っている最中なら、終わった後にもう一度走らせる
export function requestSync() {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await runOnce();
      } while (again);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function runOnce() {
  await refreshPending();
  if (!isSignedIn()) return setState({ phase: 'signedOut' });
  if (!navigator.onLine) return setState({ phase: 'offline' });
  setState({ phase: 'syncing', message: '' });
  try {
    await withFolderRetry(async () => {
      await syncSettings();
      await pushDirtyDays();
      await pullChangedDays();
      await syncQuestionLog();
    });
    setState({ phase: 'idle', lastSync: new Date(), pending: await pendingCount() });
  } catch (e) {
    console.error(e);
    if (e instanceof AuthError) setState({ phase: 'signedOut', pending: await pendingCount() });
    else setState({ phase: 'error', message: e.message, pending: await pendingCount() });
  }
}

// 覚えていたフォルダがドライブ側で消されていたら、覚え直して1回だけやり直す
async function withFolderRetry(fn) {
  try {
    await fn();
  } catch (e) {
    if (/ドライブ 404/.test(e.message)) {
      await drive.forgetFolders();
      await fn();
    } else throw e;
  }
}

// ---- 設定 ----
async function syncSettings() {
  const root = await drive.rootFolder();
  const files = await drive.findByName('設定.json', root);
  if (files.length) {
    try {
      const remote = JSON.parse(await drive.readText(files[0].id));
      await adoptRemoteSettings(remote);
    } catch (e) {
      console.warn('設定.json を読めませんでした', e);
    }
  }
  if (!(await store.kvGet('settingsDirty'))) return;
  const s = settings();
  const text = JSON.stringify(s, null, 2);
  if (files.length) await drive.updateFile(files[0].id, text, 'application/json');
  else await drive.createFile('設定.json', root, text, 'application/json');
  if (settings().updatedAt === s.updatedAt) await store.kvSet('settingsDirty', false);
}

// ---- 日記 ----
async function dirtyDays() {
  const days = new Set();
  for (const e of await store.allEntries()) if (e.dirty) days.add(e.day);
  for (const s of await store.allSummaries()) if (s.dirty) days.add(s.day);
  return [...days].sort();
}

async function pushDirtyDays() {
  for (const day of await dirtyDays()) await syncDay(day);
}

// ドライブ上の同じ日のファイル(端末が同時に作ると2つになることがある)を1つに混ぜて読む
async function readRemoteDay(day, files) {
  const entries = new Map();
  let summary = null;
  for (const f of files) {
    const parsed = parseDay(await drive.readText(f.id), day);
    for (const e of parsed.entries) {
      const old = entries.get(e.id);
      if (!old || e.updatedAt > old.updatedAt) entries.set(e.id, e);
    }
    if (parsed.summary && (!summary || parsed.summary.updatedAt > summary.updatedAt)) summary = parsed.summary;
  }
  return { entries, summary };
}

async function syncDay(day) {
  const yf = await drive.yearFolder(day.slice(0, 4));
  const files = await drive.findByName(`${day}.md`, yf);
  const remote = await readRemoteDay(day, files);

  const localEntries = await store.entriesOfDay(day);
  const localSummary = await store.getSummary(day);
  const snapshot = new Map(localEntries.map((e) => [e.id, e.updatedAt]));

  // 端末で変えた記入を、ドライブの内容に重ねる(同じ記入を両方で直していたら後から直した方)
  const result = new Map(remote.entries);
  for (const e of localEntries) {
    if (!e.dirty) continue;
    const r = result.get(e.id);
    if (r && r.updatedAt > e.updatedAt) continue;
    if (e.deleted) result.delete(e.id);
    else result.set(e.id, { ...e, dirty: false });
  }
  let summary = remote.summary;
  if (localSummary?.dirty && (!summary || localSummary.updatedAt >= summary.updatedAt)) summary = localSummary;

  const list = [...result.values()];
  if (list.length || summary) {
    const text = buildDay(day, list, summary);
    if (files.length) {
      await drive.updateFile(files[0].id, text, MD);
      for (const extra of files.slice(1)) await drive.trashFile(extra.id);
    } else {
      await drive.createFile(`${day}.md`, yf, text, MD);
    }
  } else if (files.length) {
    // その日の記入を全部消した: 空のファイルを残す(ファイルを消す権限の事故を避けるため中身だけ空にする)
    await drive.updateFile(files[0].id, buildDay(day, [], null), MD);
  }

  // 同期の間に端末で直された記入は、同期待ちのまま残す
  const final = new Map(list.map((e) => [e.id, { ...e, day, dirty: false }]));
  for (const c of await store.entriesOfDay(day)) {
    if (c.dirty && c.updatedAt !== snapshot.get(c.id)) final.set(c.id, c);
  }
  await store.replaceDay(day, [...final.values()]);
  await saveSummaryFromRemote(day, summary, localSummary);
}

async function saveSummaryFromRemote(day, summary, localBefore) {
  const now = await store.getSummary(day);
  if (now?.dirty && now.updatedAt !== localBefore?.updatedAt) return; // 同期中に直された
  if (!summary) {
    if (now && !now.dirty) await store.deleteSummary(day);
    return;
  }
  await store.putSummary({
    ...summary,
    day,
    pos: now?.pos ?? 0,
    logged: now?.logged ?? true,
    dirty: false,
  });
}

async function pullChangedDays() {
  const last = await store.kvGet('lastPull');
  const startedAt = new Date(Date.now() - 5 * 60000).toISOString(); // 端末と時計のずれを見込んで少し前から
  let query = `mimeType='${MD}' and trashed=false`;
  if (last) query += ` and modifiedTime > '${last}'`;
  const files = (await drive.listFiles(query, 'id,name,modifiedTime')).filter((f) => DAY_FILE.test(f.name));
  const byDay = new Map();
  for (const f of files) {
    const day = DAY_FILE.exec(f.name)[1];
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(f);
  }
  const dirty = new Set(await dirtyDays());
  let changed = false;
  for (const [day] of byDay) {
    if (dirty.has(day)) {
      await syncDay(day);
    } else {
      // ファイル名が同じでも別フォルダの可能性があるので、日記フォルダから読み直す
      const yf = await drive.yearFolder(day.slice(0, 4));
      const inFolder = await drive.findByName(`${day}.md`, yf);
      if (!inFolder.length) continue;
      const remote = await readRemoteDay(day, inFolder);
      await store.replaceDay(day, [...remote.entries.values()].map((e) => ({ ...e, day, dirty: false })));
      const before = await store.getSummary(day);
      await saveSummaryFromRemote(day, remote.summary, before);
    }
    changed = true;
  }
  await store.kvSet('lastPull', startedAt);
  if (changed) dataChanged();
}

// ---- 問いログ(1年1ファイル。末尾に足していく) ----
async function syncQuestionLog() {
  const pending = (await store.kvGet('qlogPending')) || [];
  const year = String(new Date().getFullYear());
  const years = new Set(pending.map((r) => r.day.slice(0, 4)));
  years.add(year);
  const lf = await drive.logFolder();
  for (const y of years) {
    const name = `${y}.jsonl`;
    const files = await drive.findByName(name, lf);
    let text = files.length ? await drive.readText(files[0].id) : '';
    const add = pending.filter((r) => r.day.slice(0, 4) === y);
    if (add.length) {
      if (text && !text.endsWith('\n')) text += '\n';
      text += add.map((r) => JSON.stringify(r)).join('\n') + '\n';
      if (files.length) await drive.updateFile(files[0].id, text, 'application/x-ndjson');
      else await drive.createFile(name, lf, text, 'application/x-ndjson');
    }
    const lines = text.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    await store.kvSet(`qlog:${y}`, lines.slice(-500));
  }
  // 送った分だけ待ち行列から外す(同期中に増えた分は残す)
  const now = (await store.kvGet('qlogPending')) || [];
  await store.kvSet('qlogPending', now.slice(pending.length));
}
