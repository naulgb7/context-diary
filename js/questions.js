// 問いの選び方と問いログ
import { settings } from './settings.js';
import { kvGet, kvSet } from './store.js';
import { generateQuestion } from './gemini.js';
import { getGeminiKey } from './settings.js';
import { diaryDay, isoLocal } from './util.js';

// ---- 問いログ ----
// 1行 = 出した問い1つ。書いて保存したときにだけ記録する(出したが何も書かずに閉じた問いは残さない)
export async function logQuestion(rec) {
  const pending = (await kvGet('qlogPending')) || [];
  pending.push(rec);
  await kvSet('qlogPending', pending);
}

async function recentLog() {
  const y = new Date().getFullYear();
  const lines = [...((await kvGet(`qlog:${y - 1}`)) || []), ...((await kvGet(`qlog:${y}`)) || []), ...((await kvGet('qlogPending')) || [])];
  return lines.sort((a, b) => (a.at < b.at ? -1 : 1));
}

// 直近に出た項目を避ける: 新しい方から項目を拾い、同じ項目が2度目に出たところで一巡の切れ目とみなす
async function pickItem() {
  const enabled = settings().randomItems.filter((i) => i.enabled && i.text.trim()).map((i) => i.text.trim());
  if (!enabled.length) return null;
  const log = (await recentLog()).filter((r) => r.kind === 'random');
  const used = [];
  for (let i = log.length - 1; i >= 0; i--) {
    const item = log[i].item;
    if (!enabled.includes(item)) continue;
    if (used.includes(item)) break;
    used.push(item);
  }
  let candidates = enabled.filter((t) => !used.includes(t));
  if (!candidates.length) candidates = enabled.filter((t) => t !== used[0]);
  if (!candidates.length) candidates = enabled;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// ---- 今出している問い(保存するまで同じ問いを出し続ける) ----
export async function currentQuestion() {
  const s = settings();
  const today = diaryDay(new Date(), s.dayBoundary);
  const cur = await kvGet('currentQuestion');
  const stillValid = cur && cur.day === today && s.randomItems.some((i) => i.enabled && i.text.trim() === cur.item);
  if (stillValid) return cur;
  return nextQuestion();
}

export async function nextQuestion() {
  const s = settings();
  const now = new Date();
  const item = await pickItem();
  let q = null;
  if (item) {
    q = { day: diaryDay(now, s.dayBoundary), kind: 'random', mode: 'list', item, question: item };
    if (s.randomMode === 'ai' && getGeminiKey() && navigator.onLine) {
      try {
        q.question = await generateQuestion(item, now);
        q.mode = 'ai';
      } catch (e) {
        console.warn('AIの問いを作れなかったので問い集の文を使います', e);
      }
    }
  }
  await kvSet('currentQuestion', q);
  return q;
}

export function questionLogRecord(q, result, entryId, at = new Date()) {
  const r = { at: isoLocal(at), day: q.day, kind: q.kind, item: q.item, question: q.question, result };
  if (q.kind === 'random') r.mode = q.mode;
  if (entryId) r.entry = entryId;
  return r;
}
