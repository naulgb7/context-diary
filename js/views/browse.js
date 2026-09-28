// 閲覧画面: 月のカレンダー・その日の日記・キーワード検索
import { $, esc, ymd, dayLabel, dateFromId, hm, debounce, diaryDay, WEEKDAYS } from '../util.js';
import * as store from '../store.js';
import { settings } from '../settings.js';
import { orderedAnswers } from '../markdown.js';
import { onShow } from '../ui.js';
import { onDataChanged } from '../sync.js';

let month = null; // その月の1日
let selected = null;
let daysWithContent = new Set();

export function initBrowse() {
  $('#calPrev').addEventListener('click', () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); renderCalendar(); });
  $('#calNext').addEventListener('click', () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); renderCalendar(); });
  $('#searchInput').addEventListener('input', debounce(search, 250));
  onShow((name) => { if (name === 'browse') refresh(); });
  onDataChanged(() => { if (!$('#view-browse').hidden) refresh(); });
}

async function refresh() {
  const today = diaryDay(new Date(), settings().dayBoundary);
  if (!month) {
    const [y, m] = today.split('-').map(Number);
    month = new Date(y, m - 1, 1);
  }
  if (!selected) selected = today;
  await loadDays();
  renderCalendar();
  await renderDay(selected);
  if ($('#searchInput').value.trim()) search();
}

async function loadDays() {
  daysWithContent = new Set();
  for (const e of await store.allEntries()) if (!e.deleted) daysWithContent.add(e.day);
  for (const s of await store.allSummaries()) if (Object.values(s.answers || {}).some((a) => a && a.trim())) daysWithContent.add(s.day);
}

function renderCalendar() {
  const y = month.getFullYear();
  const m = month.getMonth();
  const today = diaryDay(new Date(), settings().dayBoundary);
  $('#calTitle').textContent = `${y}年${m + 1}月`;
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  let html = WEEKDAYS.map((w) => `<div class="wd">${w}</div>`).join('');
  for (let i = 0; i < first; i++) html += '<div></div>';
  for (let d = 1; d <= days; d++) {
    const key = ymd(new Date(y, m, d));
    const cls = [daysWithContent.has(key) ? 'has' : '', key === today ? 'today' : '', key === selected ? 'sel' : ''].join(' ');
    html += `<button type="button" class="${cls}" data-day="${key}">${d}</button>`;
  }
  const grid = $('#calGrid');
  grid.innerHTML = html;
  for (const b of grid.querySelectorAll('button[data-day]')) {
    b.addEventListener('click', () => { selected = b.dataset.day; renderCalendar(); renderDay(selected); });
  }
}

async function renderDay(day) {
  const entries = (await store.entriesOfDay(day)).filter((e) => !e.deleted).sort((a, b) => a.id.localeCompare(b.id));
  const sm = await store.getSummary(day);
  const answered = sm ? orderedAnswers(sm).filter(([, a]) => a && a.trim()) : [];
  let html = `<h2>${esc(dayLabel(day))}</h2>`;
  if (!entries.length && !answered.length) {
    $('#dayView').innerHTML = html + '<div class="empty">この日の記入はありません</div>';
    return;
  }
  if (answered.length) {
    html += '<h2>1日のまとめ</h2>';
    for (const [q, a] of answered) html += `<h3>${esc(q)}</h3><div class="ans">${esc(a)}</div>`;
  }
  if (entries.length) {
    html += '<h2>記入</h2>';
    for (const e of entries) {
      const d = dateFromId(e.id);
      const time = d ? (ymd(d) === day ? hm(d) : `${d.getMonth() + 1}/${d.getDate()} ${hm(d)}`) : '';
      html += `<div class="entry"><div class="meta"><span>${time}</span></div>
        ${e.question ? `<div class="q">問い: ${esc(e.question)}</div>` : ''}
        <div class="body">${esc(e.text)}</div></div>`;
    }
  }
  $('#dayView').innerHTML = html;
}

function snippet(text, word) {
  const i = text.toLowerCase().indexOf(word.toLowerCase());
  const from = Math.max(0, i - 20);
  const part = text.slice(from, i + word.length + 40);
  const j = i - from;
  return (from > 0 ? '…' : '') + esc(part.slice(0, j)) + '<mark>' + esc(part.slice(j, j + word.length)) + '</mark>' + esc(part.slice(j + word.length));
}

async function search() {
  const word = $('#searchInput').value.trim();
  const box = $('#searchResults');
  if (!word) {
    box.hidden = true;
    $('#calendarWrap').hidden = false;
    $('#dayView').hidden = false;
    return;
  }
  const w = word.toLowerCase();
  const hits = [];
  for (const e of await store.allEntries()) {
    if (e.deleted) continue;
    const d = dateFromId(e.id);
    if (e.text.toLowerCase().includes(w)) hits.push({ day: e.day, key: e.id, label: d ? hm(d) : '', html: snippet(e.text, word) });
    else if (e.question && e.question.toLowerCase().includes(w)) hits.push({ day: e.day, key: e.id, label: '問い', html: snippet(e.question, word) });
  }
  for (const s of await store.allSummaries()) {
    for (const [q, a] of orderedAnswers(s)) {
      if (!a || !a.trim()) continue;
      if (a.toLowerCase().includes(w)) hits.push({ day: s.day, key: `0-${q}`, label: 'まとめ', html: `${esc(q)}: ${snippet(a, word)}` });
      else if (q.toLowerCase().includes(w)) hits.push({ day: s.day, key: `0-${q}`, label: 'まとめ', html: snippet(q, word) });
    }
  }
  hits.sort((a, b) => (a.day === b.day ? b.key.localeCompare(a.key) : b.day.localeCompare(a.day)));
  box.hidden = false;
  $('#calendarWrap').hidden = true;
  $('#dayView').hidden = true;
  if (!hits.length) {
    box.innerHTML = '<div class="empty">見つかりませんでした</div>';
    return;
  }
  box.innerHTML = `<div class="empty">${hits.length}件</div>` + hits.slice(0, 200).map((h) =>
    `<button type="button" class="hit" data-day="${h.day}"><div class="meta">${esc(dayLabel(h.day))} ${esc(h.label)}</div><div>${h.html}</div></button>`
  ).join('');
  for (const b of box.querySelectorAll('.hit')) {
    b.addEventListener('click', async () => {
      selected = b.dataset.day;
      const [y, m] = selected.split('-').map(Number);
      month = new Date(y, m - 1, 1);
      $('#searchInput').value = '';
      box.hidden = true;
      $('#calendarWrap').hidden = false;
      $('#dayView').hidden = false;
      renderCalendar();
      await renderDay(selected);
      $('#dayView').scrollIntoView();
    });
  }
}
