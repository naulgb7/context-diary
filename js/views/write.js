// 記入画面: 話すきっかけ(問い)・入力欄・マイク・保存ボタン・今日の出来事
// 2026-10-11 オーナー決定: 主役は「今日の出来事」。保存するたびに時刻付きで追記し、画面では時刻順に続けて見せる。
// 問いは答えるものではなく、話すきっかけのヒントとして出すだけ(日記には残さない)。1日のまとめはやめた
import { $, esc, diaryDay, newId, dateFromId, hm } from '../util.js';
import * as store from '../store.js';
import * as voice from '../voice.js';
import { settings } from '../settings.js';
import { currentQuestion, nextQuestion } from '../questions.js';
import { requestSync, refreshPending } from '../sync.js';
import { toast, onShow } from '../ui.js';

let question = null; // 今出しているヒント
let editingId = null;

const today = () => diaryDay(new Date(), settings().dayBoundary);

export function initWrite() {
  $('#writeSave').addEventListener('click', save);
  $('#writeCancel').addEventListener('click', cancelEdit);
  $('#qnext').addEventListener('click', async () => { question = await nextQuestion(); renderQuestion(); });
  onShow((name) => { if (name === 'write') refresh(); });
}

export async function refresh() {
  question = await currentQuestion();
  if (question && question.day !== today()) question = await nextQuestion();
  renderQuestion();
  await renderToday();
}

function renderQuestion() {
  $('#qcard').hidden = !!editingId || !question;
  $('#qtext').textContent = question ? question.question : '';
}

// 今日の出来事: 古い順に上から並べ、新しい追記が下に続く
async function renderToday() {
  const list = (await store.entriesOfDay(today())).filter((e) => !e.deleted)
    .sort((a, b) => a.id.slice(0, 15).localeCompare(b.id.slice(0, 15)) || (a.updatedAt < b.updatedAt ? -1 : 1)); // 同じ秒の追記は保存順
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
        toast('直せるのはその日の出来事だけです');
      } else {
        await store.putEntry({ ...e, text, updatedAt: nowIso, dirty: true });
        toast('保存しました');
      }
      editingId = null;
      $('#writeCancel').hidden = true;
    } else {
      const now = new Date();
      await store.putEntry({ id: newId(now), day: diaryDay(now, settings().dayBoundary), text, question: null, updatedAt: nowIso, deleted: false, dirty: true });
      question = await nextQuestion();
      toast('今日の出来事に追記しました');
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
  $('#writeCancel').hidden = true;
  renderQuestion();
  await renderToday();
}

async function remove(id) {
  const e = await store.getEntry(id);
  if (!e) return;
  if (e.day !== today()) {
    toast('消せるのはその日の出来事だけです');
    return;
  }
  if (!confirm('この部分を消しますか?')) return;
  await store.putEntry({ ...e, deleted: true, dirty: true, updatedAt: new Date().toISOString() });
  if (editingId === id) await cancelEdit();
  await renderToday();
  await refreshPending();
  requestSync();
}
