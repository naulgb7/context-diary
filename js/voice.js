// 音声入力(ブラウザの音声認識 Web Speech API)。話した内容を入力欄の末尾に足していく
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export const available = !!SR;

let rec = null;
let target = null; // 入力中のtextarea
let baseText = '';
const listeners = new Set();
let errorHandler = () => {};

export const onVoiceState = (fn) => listeners.add(fn);
export const onVoiceError = (fn) => { errorHandler = fn; };
export const isListening = () => !!rec;
export const currentTarget = () => target;
const notify = () => listeners.forEach((fn) => fn(!!rec, target));

const ERRORS = {
  'service-not-allowed': '音声認識が許可されていません。iPhoneは「設定 → プライバシーとセキュリティ → 音声認識」で許可してください',
  'not-allowed': 'マイクが許可されていません。端末の設定でこのアプリ(またはSafari)のマイクを許可してください',
  'no-speech': '声が聞き取れませんでした',
  'audio-capture': 'マイクが見つかりません',
  'network': '音声認識に電波が必要です',
};

// PCのChromeは日本語を単語ごとに空白で区切って返す(「午前 と 夕方 に」)。
// 日本語の文字に接する空白だけを消し、英単語どうしの間の空白は残す
export const tidy = (s) => s.replace(/(?<=[^\x00-\x7F]) +| +(?=[^\x00-\x7F])/g, '');

// 利用者の操作(クリック)の中から同期的に呼ぶこと。iPhoneはそうしないと開始できない
export function start(textarea) {
  if (!SR) return false;
  if (rec) stopNow();
  target = textarea;
  const r = new SR();
  r.lang = 'ja-JP';
  r.interimResults = true;
  r.continuous = true;
  baseText = textarea.value; // 止めた後にもう一度押したら、既存の文の続きに足す
  r.onresult = (ev) => {
    let text = '';
    for (let i = 0; i < ev.results.length; i++) text += ev.results[i][0].transcript;
    textarea.value = baseText + tidy(text);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  };
  r.onerror = (ev) => {
    if (ev.error === 'aborted') return;
    errorHandler(ERRORS[ev.error] || `音声認識のエラー(${ev.error})`);
  };
  r.onend = () => {
    if (rec === r) {
      rec = null;
      notify();
    }
  };
  rec = r;
  try {
    r.start();
  } catch (e) {
    rec = null;
    errorHandler(`音声認識を開始できません(${e.message})`);
  }
  notify();
  return true;
}

function stopNow() {
  const r = rec;
  rec = null;
  try { r.stop(); } catch { /* 既に止まっている */ }
  notify();
}

// 止めて、最後の言葉が入力欄に届くのを待つ
export function stop() {
  if (!rec) return Promise.resolve();
  const r = rec;
  return new Promise((resolve) => {
    const done = () => resolve();
    r.addEventListener('end', done, { once: true });
    setTimeout(done, 1500); // endが来ない端末への保険
    rec = null;
    try { r.stop(); } catch { done(); }
    notify();
  });
}

export function toggle(textarea) {
  if (rec && target === textarea) {
    stop();
    return;
  }
  start(textarea);
}
