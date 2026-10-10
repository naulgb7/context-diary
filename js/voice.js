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
export const isListening = () => !!rec;
export const currentTarget = () => target;
const notify = () => listeners.forEach((fn) => fn(!!rec, target));

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

let current = null; // 今の音声入力で文字が出たか
// 2026-10-10 の記録では、マイクは開くのに声が届かない状態が30秒〜1分続き、画面の読み込み直しでは直らず、時間がたつと直った。
// アプリの中では直せないので、知らせて待ってもらう
const NO_TEXT = 'マイクに声が届いていないようです。スマートグラスやイヤホンなどのBluetooth機器をつないでいるときは外すか、30秒ほど待ってからもう一度押してください';

// iPhoneは話した内容を1つの結果に足し続けて返すことが多いので、結果の数ではなく文字数で区切る。
// consumed = 改行ボタンや手入力の時点までに入力欄へ確定させた、認識結果の文字数
let consumed = 0;
let lastFull = '';

// 利用者の操作(クリック)の中から同期的に呼ぶこと。iPhoneはそうしないと開始できない
export function start(textarea) {
  if (!SR) return false;
  vlog(`start 入力欄=${textarea.id} キーボード=${document.activeElement?.matches?.('textarea, input') ? 'あり' : 'なし'} 前の認識=${rec ? 'あり' : 'なし'}`);
  if (rec) stopNow();
  // キーボードで入力した直後(キーボードが出たまま)に始めると、iPhoneでは声が文字にならなくなることがある。
  // 先にキーボードを閉じてから始める
  if (document.activeElement instanceof HTMLElement && document.activeElement.matches('textarea, input')) document.activeElement.blur();
  target = textarea;
  const r = new SR();
  r.lang = 'ja-JP';
  r.interimResults = true;
  r.continuous = true;
  baseText = textarea.value; // 止めた後にもう一度押したら、既存の文の続きに足す
  consumed = 0;
  lastFull = '';
  const session = { gotResult: false, startedAt: Date.now() };
  current = session;
  r.onresult = (ev) => {
    if (!session.gotResult) vlog('result(最初の文字)');
    heard = true;
    session.gotResult = true;
    clearTimeout(soundTimer);
    let text = '';
    let full = '';
    for (let i = 0; i < ev.results.length; i++) full += ev.results[i][0].transcript;
    lastFull = full;
    text = full.slice(consumed);
    textarea.value = baseText + commands(tidy(text));
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  };
  r.onerror = (ev) => {
    vlog(`error ${ev.error}`);
    if (ev.error === 'aborted') return;
    errorHandler(ERRORS[ev.error] || `音声認識のエラー(${ev.error})`);
  };
  r.onend = () => {
    vlog(`end 文字=${session.gotResult ? 'あり' : 'なし'}`);
    clearTimeout(watchdog);
    clearTimeout(soundTimer);
    if (rec === r) {
      rec = null;
      notify();
    }
  };
  // 前の音声入力がiPhoneの中で終わりきらないうちに始めると、マイクは赤いのに音を拾わないことがある。
  // 3秒たってもマイクが開かなければ(黙っているだけなら止めない)、赤いままにせず止めて知らせる
  let heard = false;
  r.onstart = () => vlog('onstart');
  r.onaudiostart = () => { heard = true; vlog('audiostart'); };
  r.onsoundstart = () => vlog('soundstart');
  // 声を拾ったのに文字が5秒たっても出てこないときも、止めて知らせる
  let soundTimer = null;
  r.onspeechstart = () => { // 物音(soundstart)では数えず、声(speechstart)を拾ったときだけ見張る
    vlog('speechstart');
    heard = true;
    if (session.gotResult || soundTimer) return;
    soundTimer = setTimeout(() => {
      if (session.gotResult || rec !== r) return;
      vlog('見張り: 声を拾って5秒文字なし');
      rec = null;
      try { r.abort(); } catch { /* 既に止まっている */ }
      notify();
      errorHandler(NO_TEXT);
    }, 5000);
  };
  const watchdog = setTimeout(() => {
    if (heard || rec !== r) return;
    vlog('見張り: 3秒マイク開かず');
    rec = null;
    try { r.abort(); } catch { /* 既に止まっている */ }
    notify();
    errorHandler('音声入力が始まりませんでした。もう一度マイクを押してください');
  }, 3000);
  // 音声入力中に手で入力・修正したら(キーボードでの入力は isTrusted が true)、それを土台にして続きを足す
  const onType = (ev) => {
    if (!ev.isTrusted || rec !== r) return;
    baseText = textarea.value;
    consumed = lastFull.length;
    vlog('音声入力中に手で入力');
  };
  textarea.addEventListener('input', onType);
  r.addEventListener('end', () => textarea.removeEventListener('input', onType), { once: true });
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
  if (rec && target === textarea) {
    // 赤いまま文字が1つも出ないので止めた、という場合は、声が届いていないことを知らせる
    const s = current;
    vlog(`toggle停止 文字=${s?.gotResult ? 'あり' : 'なし'} 経過=${s ? Date.now() - s.startedAt : '-'}ms`);
    stop().then(() => {
      if (s && !s.gotResult && Date.now() - s.startedAt > 2500) errorHandler(NO_TEXT);
    });
    return;
  }
  start(textarea);
}
