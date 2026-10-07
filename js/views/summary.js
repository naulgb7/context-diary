// 1日のまとめ: 設定した問いを1問ずつ。飛ばせる・戻れる・途中で閉じても続きから
import { $, diaryDay, debounce } from '../util.js';
import * as store from '../store.js';
import * as voice from '../voice.js';
import { settings } from '../settings.js';
import { logQuestion, questionLogRecord } from '../questions.js';
import { requestSync, refreshPending } from '../sync.js';
import { toast, show, onBack } from '../ui.js';

let sm = null; // 書いている まとめ

export function initSummary() {
  $('#sumPrev').addEventListener('click', () => move(-1));
  $('#sumNext').addEventListener('click', () => move(1));
  onBack('summary', leave); // 共通の戻るボタンで閉じるときも、書きかけを保存する
  const saveDraft = debounce(() => persist(), 600);
  $('#sumText').addEventListener('input', () => {
    if (!sm) return;
    const q = sm.questions[sm.pos];
    if ((sm.answers[q] || '') === $('#sumText').value) return;
    sm.answers[q] = $('#sumText').value;
    sm.changed = true;
    saveDraft();
  });
}

export async function openSummary(startPos = null) {
  const day = diaryDay(new Date(), settings().dayBoundary);
  const saved = await store.getSummary(day);
  const configured = settings().summaryQuestions.filter((q) => q.trim());
  const answers = saved?.answers || {};
  const questions = [...configured];
  for (const k of Object.keys(answers)) if (answers[k]?.trim() && !questions.includes(k)) questions.push(k);
  if (!questions.length) {
    toast('まとめの問いが設定されていません。設定画面で追加してください');
    return;
  }
  sm = {
    day,
    answers: { ...answers },
    questions,
    pos: startPos !== null ? Math.min(startPos, questions.length - 1) : saved && saved.status !== 'done' ? Math.min(saved.pos || 0, questions.length - 1) : 0,
    status: saved?.status || 'draft',
    updatedAt: saved?.updatedAt || '',
    dirty: saved?.dirty || false,
    logged: saved?.logged || false,
    changed: false,
  };
  show('summary');
  render();
}

// 音声入力の立て直し(画面の読み込み直し)の前後で使う
export const currentPos = () => (sm ? sm.pos : null);
export const flushSummary = () => persist();

function render() {
  const n = sm.questions.length;
  const q = sm.questions[sm.pos];
  $('#sumPos').textContent = `${sm.pos + 1}/${n}`;
  $('#sumQ').textContent = q;
  $('#sumText').value = sm.answers[q] || '';
  $('#sumText').updateHint?.();
  $('#sumPrev').disabled = sm.pos === 0;
  $('#sumNext').textContent = sm.pos === n - 1 ? '完了' : '次へ';
}

async function persist() {
  if (!sm) return;
  const { changed, ...rest } = sm;
  if (changed) {
    rest.updatedAt = new Date().toISOString();
    rest.dirty = true;
    sm.updatedAt = rest.updatedAt;
    sm.dirty = true;
    sm.changed = false;
  }
  await store.putSummary(rest);
}

async function move(step) {
  await voice.stop();
  const last = sm.pos === sm.questions.length - 1;
  if (step > 0 && last) return finish();
  sm.pos = Math.max(0, Math.min(sm.questions.length - 1, sm.pos + step));
  await persist();
  render();
}

async function finish() {
  if (sm.status !== 'done') {
    sm.status = 'done';
    sm.changed = true;
  }
  // 問いログは最初に完了したときだけ残す(当日中に直しても重ねて記録しない)
  if (!sm.logged) {
    const now = new Date();
    for (const q of sm.questions) {
      const answered = !!(sm.answers[q] || '').trim();
      await logQuestion(questionLogRecord({ day: sm.day, kind: 'summary', item: q, question: q }, answered ? 'answered' : 'skipped', null, now));
    }
    sm.logged = true;
  }
  await persist();
  sm = null;
  toast('1日のまとめを保存しました');
  await refreshPending();
  requestSync();
  show('write');
}

async function leave() {
  await voice.stop();
  if (sm) await persist();
  sm = null;
  await refreshPending();
  requestSync();
}
