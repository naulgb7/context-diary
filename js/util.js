// 日付・id・文字列の小物

export const pad = (n) => String(n).padStart(2, '0');

export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// 実時刻 → 日記の日付(切替時刻より前の深夜は前日扱い)
export function diaryDay(date, boundary) {
  const d = new Date(date.getTime() - toMinutes(boundary) * 60000);
  return ymd(d);
}

export function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function hm(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 端末のタイムゾーン付きISO文字列(例: 2026-09-28T15:04:25+09:00)
export function isoLocal(d) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

export function dayLabel(day) {
  const [y, m, d] = day.split('-').map(Number);
  const w = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${y}年${m}月${d}日(${w})`;
}

export const device = /iPhone|iPad|iPod/.test(navigator.userAgent) ? 'iphone' : 'pc';

// 記入のid: 20260928-150425-iphone-k3 (時刻が読めて、端末間で重ならない)
export function newId(date) {
  const s = `${ymd(date).replace(/-/g, '')}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${s}-${device}-${Math.random().toString(36).slice(2, 4)}`;
}

// idから記入の実時刻を取り出す
export function dateFromId(id) {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(id);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
