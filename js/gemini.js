// AIの問い(Gemini API)。送るのはテーマ・日時・曜日だけで、日記の本文は送らない
import { getGeminiKey, getGeminiModel, setGeminiModel } from './settings.js';
import { WEEKDAYS, pad } from './util.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

async function request(path, options = {}, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/${path}`, {
      ...options,
      signal: ctrl.signal,
      headers: { 'x-goog-api-key': getGeminiKey(), 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 160)}`);
    return res.json();
  } finally {
    clearTimeout(t);
  }
}

// 使えるモデルの一覧から、無料枠で使いやすい Flash 系を選んで覚えておく
async function model() {
  const cached = getGeminiModel();
  if (cached) return cached;
  const r = await request('models?pageSize=1000');
  const usable = (r.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /flash/.test(m.name));
  const stable = usable.filter((m) => !/lite|image|tts|live|audio|exp|thinking|preview|latest/.test(m.name));
  const pick = (stable.length ? stable : usable).map((m) => m.name).sort().reverse()[0];
  if (!pick) throw new Error('使えるGeminiのモデルが見つかりません');
  setGeminiModel(pick);
  return pick;
}

export async function generateQuestion(theme, date = new Date()) {
  if (!getGeminiKey()) throw new Error('Gemini APIキーが未設定です');
  const when = `${date.getMonth() + 1}月${date.getDate()}日(${WEEKDAYS[date.getDay()]}) ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const prompt =
    `あなたは日記アプリの問いかけ役です。${when}に日記を書こうとしている人に、` +
    `テーマ「${theme}」に沿った問いを1つだけ作ってください。` +
    '条件: 日本語、40字以内、答えやすい具体的な問い、前置きや説明や引用符を付けずに問いの文だけを出力する。';
  const name = await model();
  let r;
  try {
    r = await request(`${name}:generateContent`, {
      method: 'POST',
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 1.0 } }),
    });
  } catch (e) {
    if (/Gemini 404/.test(e.message)) setGeminiModel(''); // モデルが廃止されたら次回選び直す
    throw e;
  }
  const text = (r.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  const line = text.split('\n').map((s) => s.trim().replace(/^["「『]|["」』]$/g, '')).find((s) => s);
  if (!line) throw new Error('AIの返答が空でした');
  return line.slice(0, 80);
}

export function resetModel() {
  setGeminiModel('');
}
