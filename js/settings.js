// 設定: PC・iPhone共通の設定(ドライブの 設定.json に同期)と、端末だけの設定(localStorage)
import { kvGet, kvSet } from './store.js';

export const MAX_SUMMARY_QUESTIONS = 10;

export const DEFAULT_SETTINGS = {
  summaryQuestions: ['今日いちばん印象に残っていることは?', '明日やろうと思っていることは?'],
  summaryStartTime: '21:00',
  randomItems: [
    { text: '今の気分は?', enabled: true },
    { text: '今、何をしていますか?', enabled: true },
    { text: '最近気になっていることは?', enabled: true },
    { text: '今日うれしかったことは?', enabled: true },
    { text: '今考えていることは?', enabled: true },
  ],
  randomMode: 'list', // list=問い集から抽選 / ai=AIが作る
  dayBoundary: '04:00',
  updatedAt: '1970-01-01T00:00:00Z',
};

let current = null;
const listeners = new Set();

export async function loadSettings() {
  const saved = await kvGet('settings');
  current = { ...DEFAULT_SETTINGS, ...(saved || {}) };
  return current;
}

export const settings = () => current;

export function onSettingsChange(fn) {
  listeners.add(fn);
}

// 画面で変えたとき: 端末に保存し、同期待ちにする
export async function updateSettings(patch) {
  current = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await kvSet('settings', current);
  await kvSet('settingsDirty', true);
  listeners.forEach((fn) => fn(current));
}

// ドライブから読んだとき: 端末の方が新しくなければ採用する
export async function adoptRemoteSettings(remote) {
  const dirty = await kvGet('settingsDirty');
  if (dirty && current.updatedAt >= remote.updatedAt) return false;
  current = { ...DEFAULT_SETTINGS, ...remote };
  await kvSet('settings', current);
  await kvSet('settingsDirty', false);
  listeners.forEach((fn) => fn(current));
  return true;
}

// ---- 端末だけの設定(ドライブに送らない) ----
function lsGet(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function lsSet(k, v) {
  try {
    if (v === null || v === '') localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch { /* 保存できない環境では何もしない */ }
}

export const getGeminiKey = () => lsGet('geminiKey') || '';
export const setGeminiKey = (v) => lsSet('geminiKey', v.trim());
export const getGeminiModel = () => lsGet('geminiModel') || '';
export const setGeminiModel = (v) => lsSet('geminiModel', v);
export { lsGet, lsSet };
