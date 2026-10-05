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

// 話している途中で「改行(かいぎょう)」と言ったら改行にする。PCのChromeは「開業」と聞き取るので、それも改行として扱う
const commands = (s) => s.replace(/\s*(改行|かいぎょう|開業)[。、]?\s*/g, '\n');

let consumed = 0; // 改行ボタンを押した時点までに入力欄へ確定させた認識結果の数
let lastLen = 0;

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
  consumed = 0;
  lastLen = 0;
  r.onresult = (ev) => {
    heard = true;
    let text = '';
    for (let i = consumed; i < ev.results.length; i++) text += ev.results[i][0].transcript;
    lastLen = ev.results.length;
    textarea.value = baseText + commands(tidy(text));
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  };
  r.onerror = (ev) => {
    if (ev.error === 'aborted') return;
    errorHandler(ERRORS[ev.error] || `音声認識のエラー(${ev.error})`);
  };
  r.onend = () => {
    clearTimeout(watchdog);
    if (rec === r) {
      rec = null;
      notify();
    }
  };
  // 前の音声入力がiPhoneの中で終わりきらないうちに始めると、マイクは赤いのに音を拾わないことがある。
  // 3秒たってもマイクが音を拾い始めなければ(黙っているだけなら止めない)、赤いままにせず止めて知らせる
  let heard = false;
  r.onaudiostart = r.onsoundstart = () => { heard = true; };
  const watchdog = setTimeout(() => {
    if (heard || rec !== r) return;
    rec = null;
    try { r.abort(); } catch { /* 既に止まっている */ }
    notify();
    errorHandler('音声入力が始まりませんでした。もう一度マイクを押してください');
  }, 3000);
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

// 改行ボタン: 音声入力中でも止めずに、今の位置で改行する
export function newline(textarea) {
  if (rec && target === textarea) {
    baseText = textarea.value.replace(/[ \t]+$/, '') + '\n';
    consumed = lastLen;
    textarea.value = baseText;
  } else if (document.activeElement === textarea) {
    textarea.setRangeText('\n', textarea.selectionStart, textarea.selectionEnd, 'end');
  } else {
    textarea.value += '\n'; // キーボードを出さないよう、入力欄は選ばずに末尾へ足す
  }
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

export function toggle(textarea) {
  if (rec && target === textarea) {
    stop();
    return;
  }
  start(textarea);
}
