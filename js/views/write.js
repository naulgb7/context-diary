// 記入画面: 問い・入力欄・マイク・保存ボタン・今日のメモ
import { $, esc, diaryDay, newId, dateFromId, hm, toMinutes } from '../util.js';
import * as store from '../store.js';
import * as voice from '../voice.js';
import { settings } from '../settings.js';
import { currentQuestion, nextQuestion, logQuestion, questionLogRecord } from '../questions.js';
import { requestSync, refreshPending } from '../sync.js';
import { toast, onShow } from '../ui.js';
import { openSummary } from './summary.js';

let question = null; // 今出している問い
let dropped = false; // ×で問いを外したか
let editingId = null;

const today = () => diaryDay(new Date(), settings().dayBoundary);

export function initWrite() {
  $('#qdrop').addEventListener('click', () => { dropped = true; renderQuestion(); });
  $('#qrestore').addEventListener('click', () => { dropped = false; renderQuestion(); });
  $('#writeSave').addEventListener('click', save);
  $('#writeCancel').addEventListener('click', cancelEdit);
  $('#summaryOpen').addEventListener('click', () => openSummary());
  onShow((name) => { if (name === 'write') refresh(); });
  setInterval(() => { if (!document.hidden) renderSummaryBar(); }, 60000);
}

export async function refresh() {
  question = await currentQuestion();
  if (question && question.day !== today()) question = await nextQuestion();
  renderQuestion();
  await renderToday();
  await renderSummaryBar();
}

function renderQuestion() {
  const editing = !!editingId;
  $('#qcard').hidden = editing || !question || dropped;
  $('#qfree').hidden = editing || !question || !dropped;
  $('#qtext').textContent = question ? question.question : '';
}

// まとめ開始時刻を過ぎたら(1日の切替時刻までは)まとめのボタンを出す
async function renderSummaryBar() {
  const s = settings();
  const now = new Date();
  const sinceStart = (now.getHours() * 60 + now.getMinutes() - toMinutes(s.dayBoundary) + 1440) % 1440;
  const startAt = (toMinutes(s.summaryStartTime) - toMinutes(s.dayBoundary) + 1440) % 1440;
  const visible = s.summaryQuestions.length > 0 && sinceStart >= startAt;
  $('#summaryBar').hidden = !visible;
  if (!visible) return;
  const sm = await store.getSummary(today());
  $('#summaryOpen').textContent = !sm ? '1日のまとめを書く' : sm.status === 'done' ? '1日のまとめを直す' : '1日のまとめの続きを書く';
}

async function renderToday() {
  const day = today();
  const list = (await store.entriesOfDay(day)).filter((e) => !e.deleted).sort((a, b) => b.id.localeCompare(a.id));
  const box = $('#todayList');
  if (!list.length) {
    box.innerHTML = '<div class="empty">今日はまだ何もありません</div>';
    return;
  }
  box.innerHTML = list.map((e) => {
    const d = dateFromId(e.id);
    return `<div class="entry${e.id === editingId ? ' editing' : ''}" data-id="${esc(e.id)}">
      <div class="meta"><span>${d ? hm(d) : ''}${e.dirty ? ' (未送信)' : ''}</span>
        <span class="acts"><button class="act-edit" data-act="edit" type="button">修正</button><button class="act-del" data-act="del" type="button">削除</button></span></div>
      ${e.question ? `<div class="q">問い: ${esc(e.question)}</div>` : ''}
      <div class="body">${esc(e.text)}</div></div>`;
  }).join('');
  for (const b of box.querySelectorAll('button[data-act]')) {
    b.addEventListener('click', () => {
      const id = b.closest('.entry').dataset.id;
      if (b.dataset.act === 'edit') startEdit(id);
      else remove(id);
    });
  }
}

async function save() {
  await voice.stop();
  const ta = $('#writeText');
  const text = ta.value.trim();
  if (!text) {
    toast('入力欄が空です');
    return;
  }
  const btn = $('#writeSave');
  btn.disabled = true;
  try {
    const nowIso = new Date().toISOString();
    if (editingId) {
      const e = await store.getEntry(editingId);
      if (!e || e.day !== today()) {
        toast('直せるのはその日のメモだけです');
      } else {
        await store.putEntry({ ...e, text, updatedAt: nowIso, dirty: true });
        toast('保存しました');
      }
      editingId = null;
      $('#writeCancel').hidden = true;
      btn.textContent = '保存';
    } else {
      const now = new Date();
      const id = newId(now);
      const q = question && !dropped ? question : null;
      await store.putEntry({ id, day: diaryDay(now, settings().dayBoundary), text, question: q ? q.question : null, updatedAt: nowIso, deleted: false, dirty: true });
      if (question) await logQuestion(questionLogRecord(question, dropped ? 'skipped' : 'answered', id, now));
      dropped = false;
      question = await nextQuestion();
      toast('保存しました');
    }
    ta.value = '';
    ta.updateHint?.();
    renderQuestion();
    await renderToday();
    await refreshPending();
    requestSync();
  } finally {
    btn.disabled = false;
  }
}

async function startEdit(id) {
  const e = await store.getEntry(id);
  if (!e) return;
  await voice.stop();
  editingId = id;
  $('#writeText').value = e.text;
  $('#writeText').updateHint?.();
  $('#writeSave').textContent = '保存';
  $('#writeCancel').hidden = false;
  renderQuestion();
  await renderToday();
  window.scrollTo(0, 0);
}

async function cancelEdit() {
  await voice.stop();
  editingId = null;
  $('#writeText').value = '';
  $('#writeText').updateHint?.();
  $('#writeSave').textContent = '保存';
  $('#writeCancel').hidden = true;
  renderQuestion();
  await renderToday();
}

async function remove(id) {
  const e = await store.getEntry(id);
  if (!e) return;
  if (e.day !== today()) {
    toast('消せるのはその日のメモだけです');
    return;
  }
  if (!confirm('このメモを消しますか?')) return;
  await store.putEntry({ ...e, deleted: true, dirty: true, updatedAt: new Date().toISOString() });
  if (editingId === id) await cancelEdit();
  await renderToday();
  await refreshPending();
  requestSync();
}
