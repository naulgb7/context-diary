// 画面の共通部品: お知らせ表示・アイコン・画面切り替え
import { $, $$ } from './util.js';

export const ICONS = {
  mic: '<svg viewBox="0 0 24 24"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg>',
  pencil: '<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
  calendar: '<svg viewBox="0 0 24 24"><path d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V9h14v11z"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><path d="M19.14 12.94a7.5 7.5 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7 7 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54a7 7 0 0 0-1.63.94l-2.39-.96a.5.5 0 0 0-.61.22L2.7 8.48a.5.5 0 0 0 .12.64l2.03 1.58a7.5 7.5 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.3.61.22l2.39-.96c.5.39 1.05.7 1.63.94l.36 2.54c.05.24.25.42.49.42h3.8c.24 0 .45-.18.49-.42l.36-2.54a7 7 0 0 0 1.63-.94l2.39.96c.22.08.48 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"/></svg>',
};

let toastTimer = null;
export function toast(msg, ms = 3500) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

let currentView = 'write';
const history = []; // 戻るボタン用: これまでに開いた画面
const backHandlers = {}; // 画面ごとに、戻る前に済ませる処理(まとめの保存など)
const showListeners = new Set();
export const onShow = (fn) => showListeners.add(fn);
export const viewName = () => currentView;
export const onBack = (name, fn) => { backHandlers[name] = fn; };

export function show(name, { fromBack = false } = {}) {
  if (!fromBack && name !== currentView) {
    backHandlers[currentView]?.(); // タブで他の画面へ移るときも、書きかけを保存する
    history.push(currentView);
    if (history.length > 10) history.shift();
  }
  if (name === 'write') history.length = 0; // 記入画面が起点。そこからは戻る先がない
  currentView = name;
  for (const v of $$('.view')) v.hidden = v.id !== `view-${name}`;
  const tab = name === 'summary' ? 'write' : name;
  for (const b of $$('.tabs button')) b.classList.toggle('active', b.dataset.tab === tab);
  $('#backBtn').disabled = name === 'write'; // 記入画面が起点なので戻る先がない
  window.scrollTo(0, 0);
  showListeners.forEach((fn) => fn(name));
}

// 共通の戻るボタン: 前の画面へ(音声入力は始めない)
export async function back() {
  const handler = backHandlers[currentView];
  if (handler) await handler();
  let prev = history.pop() || 'write';
  if (prev === currentView) prev = 'write';
  show(prev, { fromBack: true });
}
