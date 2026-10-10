// 音声入力(ブラウザの音声認識 Web Speech API)。話した内容を入力欄の末尾に足していく
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export const available = !!SR;

// 音声入力の調査用の記録(直近80件)。設定画面で見て、コピーしてもらう
export function vlog(msg) {
  try {
    const list = JSON.parse(localStorage.getItem('voiceLog') || '[]');
    const d = new Date();
    list.push(`${d.toLocaleTimeString('ja-JP')}.${String(d.getMilliseconds()).padStart(3, '0')} ${msg}`);
    localStorage.setItem('voiceLog', JSON.stringify(list.slice(-80)));
  } catch { /* 記録できなくても動作は続ける */ }
}
export const voiceLog = () => { try { return JSON.parse(localStorage.getItem('voiceLog') || '[]'); } catch { return []; } };

let rec = null;
let target = null; // 入力中のtextarea
let baseText = '';
const listeners = new Set();
let errorHandler = () => {};

export const onVoiceState = (fn) => listeners.add(fn);
export const onVoiceError = (fn) => { errorHandler = fn; };
export const currentTarget = () => target;
const notify = () => listeners.forEach((fn) => fn(!!rec && !paused, target));

const ERRORS = {
  'service-not-allowed': '音声認識が許可されていません。iPhoneは「設定 → プライバシーとセキュリティ → 音声認識」で許可してください',
  'not-allowed': 'マイクが許可されていません。端末の設定でこのアプリ(またはSafari)のマイクを許可してください',
  'no-speech': '声が聞き取れませんでした',
  'audio-capture': 'マイクを使えませんでした。通話・録音・スマートグラスなど、ほかのアプリや機器がマイクを使っていないか確かめて、もう一度押してください',
  'network': '音声認識に電波が必要です',
};

// PCのChromeは日本語を単語ごとに空白で区切って返す(「午前 と 夕方 に」)。
// 日本語の文字に接する空白だけを消し、英単語どうしの間の空白は残す
export const tidy = (s) => s.replace(/(?<=[^\x00-\x7F]) +| +(?=[^\x00-\x7F])/g, '');

// 話している途中で「改行(かいぎょう)」と言ったら改行にする。PCのChromeは「開業」と聞き取るので、それも改行として扱う
const commands = (s) => s.replace(/\s*(改行|かいぎょう|開業)[。、]?\s*/g, '\n');

let current = null; // 今の回の記録用(文字が出たか・始めた時刻)
const NO_TEXT = 'マイクに声が届いていないようです。少し待ってからもう一度押すか、入力欄を押してキーボードのマイクを使ってください';

// iPhoneは話した内容を1つの結果に足し続けて返すことが多いので、結果の数ではなく文字数で区切る。
// consumed = 入力欄へ確定させた(または一時停止中で捨てた)認識結果の文字数
let consumed = 0;
let lastFull = '';

// 一時停止方式(2026-10-10 オーナー決定)。
// iPhoneは音声認識を止めると約1分マイクを手放さず、その間に始めた回には声が届かない(記録で確認)。
// そこで、いったん始めた音声認識は止めずに動かし続け、マイクのボタンでは「文字を入れる/入れない」だけを切り替える。
// 本当に止めるのは、アプリが裏に回ったとき(hardStop)と、iPhoneが自分で切ったときだけ
let paused = false;
const setPaused = (v) => { paused = v; notify(); };
export const isListening = () => !!rec && !paused;

const typedBound = new WeakSet();
// 音声入力中に手で入力・修正したら(キーボードでの入力は isTrusted が true)、それを土台にして続きを足す
function bindTyping(textarea) {
  if (typedBound.has(textarea)) return;
  typedBound.add(textarea);
  textarea.addEventListener('input', (ev) => {
    if (!ev.isTrusted || !rec || paused || target !== textarea) return;
    baseText = textarea.value;
    consumed = lastFull.length;
    vlog('音声入力中に手で入力');
  });
}

// 一時停止中から、指定の入力欄へ文字を入れる状態に戻す
function resume(textarea) {
  target = textarea;
  baseText = textarea.value;
  consumed = lastFull.length; // 一時停止中に話した分は入れない
  bindTyping(textarea);
  vlog(`再開 入力欄=${textarea.id}`);
  setPaused(false);
}

// 利用者の操作(クリック)の中から同期的に呼ぶこと。iPhoneはそうしないと開始できない
export function start(textarea) {
  if (!SR) return false;
  // キーボードが出たまま始めると声が文字にならないことがあるので、先に閉じる
  if (document.activeElement instanceof HTMLElement && document.activeElement.matches('textarea, input')) document.activeElement.blur();
  if (rec) { resume(textarea); return true; } // 動き続けているので、つなぎ直すだけ
  vlog(`start 入力欄=${textarea.id}`);
  target = textarea;
  baseText = textarea.value;
  consumed = 0;
  lastFull = '';
  bindTyping(textarea);
  const r = new SR();
  r.lang = 'ja-JP';
  r.interimResults = true;
  r.continuous = true;
  const session = { gotResult: false, startedAt: Date.now() };
  current = session;
  r.onresult = (ev) => {
    let full = '';
    for (let i = 0; i < ev.results.length; i++) full += ev.results[i][0].transcript;
    lastFull = full;
    if (paused || rec !== r) return; // 一時停止中は捨てる(再開時に consumed で読み飛ばす)
    if (!session.gotResult) vlog('result(最初の文字)');
    session.gotResult = true;
    target.value = baseText + commands(tidy(full.slice(consumed)));
    target.dispatchEvent(new Event('input', { bubbles: true }));
  };
  r.onerror = (ev) => {
    vlog(`error ${ev.error}`);
    if (ev.error === 'aborted' || paused) return;
    errorHandler(ERRORS[ev.error] || `音声認識のエラー(${ev.error})`);
  };
  r.onend = () => {
    vlog(`end 経過=${Date.now() - session.startedAt}ms`);
    if (rec === r) {
      rec = null;
      paused = false;
      notify();
    }
  };
  r.onstart = () => vlog(`onstart ${Date.now() - session.startedAt}ms`);
  r.onaudiostart = () => vlog(`audiostart ${Date.now() - session.startedAt}ms`);
  r.onspeechstart = () => vlog('speechstart');
  r.onaudioend = () => vlog('audioend');
  rec = r;
  paused = false;
  try {
    r.start();
  } catch (e) {
    vlog(`start失敗 ${e.name} ${e.message}`);
    rec = null;
    errorHandler(`音声認識を開始できません(${e.message})`);
  }
  notify();
  return true;
}

// 保存・画面の切り替え・マイクのボタンで呼ぶ。音声認識は止めずに一時停止にする
export function stop() {
  if (rec && !paused) {
    vlog('一時停止');
    setPaused(true);
  }
  return Promise.resolve();
}

// アプリが裏に回ったときに本当に止める(マイクを手放す)
export function hardStop() {
  if (!rec) return;
  vlog('完全に停止(アプリが裏に回った)');
  const r = rec;
  rec = null;
  paused = false;
  try { r.abort(); } catch { /* 既に止まっている */ }
  notify();
}

// 改行ボタン: 音声入力中でも止めずに、今の位置で改行する
export function newline(textarea) {
  if (rec && !paused && target === textarea) {
    baseText = textarea.value.replace(/[ \t]+$/, '') + '\n';
    consumed = lastFull.length;
    textarea.value = baseText;
  } else if (document.activeElement === textarea) {
    textarea.setRangeText('\n', textarea.selectionStart, textarea.selectionEnd, 'end');
  } else {
    textarea.value += '\n'; // キーボードを出さないよう、入力欄は選ばずに末尾へ足す
  }
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

export function toggle(textarea) {
  if (rec && !paused && target === textarea) {
    const s = current;
    vlog(`toggle一時停止 文字=${s?.gotResult ? 'あり' : 'なし'}`);
    stop();
    return;
  }
  start(textarea);
}
