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
const BUSY = 'マイクの準備中です。前の音声入力から1分ほどは使えないことがあります。入力欄を押してキーボードのマイクで入力するか、少し待ってからもう一度押してください';
const NO_TEXT = 'マイクに声が届いていないようです。スマートグラスやイヤホンなどのBluetooth機器をつないでいるときは外すか、30秒ほど待ってからもう一度押してください';

// iPhoneは話した内容を1つの結果に足し続けて返すことが多いので、結果の数ではなく文字数で区切る。
// consumed = 改行ボタンや手入力の時点までに入力欄へ確定させた、認識結果の文字数
let consumed = 0;
let lastFull = '';

// 認識の仕組みは1つだけ作って使い回す。
// 2026-10-10 の記録: 止めるたびに新しく作ると、次の回はマイクが開いたように見えて(開始の合図が5ミリ秒で返る)声が届かず、
// 15〜40秒後に audio-capture で終わるまで使えなかった。前の回のマイクが残ったまま新しい回がつながっている形
let inst = null;
let running = false; // 認識の仕組みが動いている(end がまだ来ていない)
let queued = null; // 前の回の終わりを待ってから始める入力欄
const getInst = () => {
  if (!inst) {
    inst = new SR();
    inst.lang = 'ja-JP';
    inst.interimResults = true;
    inst.continuous = true;
  }
  return inst;
};

// 利用者の操作(クリック)の中から同期的に呼ぶこと。iPhoneはそうしないと開始できない
export function start(textarea) {
  if (!SR) return false;
  vlog(`start 入力欄=${textarea.id} キーボード=${document.activeElement?.matches?.('textarea, input') ? 'あり' : 'なし'} 前の認識=${rec ? 'あり' : 'なし'} 動作中=${running ? 'はい' : 'いいえ'}`);
  if (rec) stopNow();
  // キーボードで入力した直後(キーボードが出たまま)に始めると、iPhoneでは声が文字にならなくなることがある。
  // 先にキーボードを閉じてから始める
  if (document.activeElement instanceof HTMLElement && document.activeElement.matches('textarea, input')) document.activeElement.blur();
  target = textarea;
  const r = getInst();
  baseText = textarea.value; // 止めた後にもう一度押したら、既存の文の続きに足す
  consumed = 0;
  lastFull = '';
  const session = { gotResult: false, startedAt: Date.now() };
  current = session;
  const mine = () => current === session; // 前の回の合図が遅れて届いても混ぜない
  let heard = false;
  let soundTimer = null;
  let watchdog = null;
  r.onresult = (ev) => {
    if (!mine()) return;
    if (!session.gotResult) vlog('result(最初の文字)');
    heard = true;
    session.gotResult = true;
    clearTimeout(soundTimer);
    let full = '';
    for (let i = 0; i < ev.results.length; i++) full += ev.results[i][0].transcript;
    lastFull = full;
    textarea.value = baseText + commands(tidy(full.slice(consumed)));
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  };
  r.onerror = (ev) => {
    vlog(`error ${ev.error}`);
    if (!mine() || ev.error === 'aborted') return;
    errorHandler(ERRORS[ev.error] || `音声認識のエラー(${ev.error})`);
  };
  r.onend = () => {
    running = false;
    vlog(`end 文字=${session.gotResult ? 'あり' : 'なし'}`);
    clearTimeout(watchdog);
    clearTimeout(soundTimer);
    textarea.removeEventListener('input', onType);
    if (mine() && rec === r) {
      rec = null;
      notify();
    }
    if (queued) { // 前の回が終わったので、待たせていた回を始める
      const t = queued;
      queued = null;
      vlog('待たせていた開始を実行');
      start(t);
    }
  };
  r.onstart = () => {
    const ms = Date.now() - session.startedAt;
    vlog(`onstart ${ms}ms${ms < 200 ? '(速すぎる: 前の回のマイクが残っている疑い)' : ''}`);
  };
  r.onaudiostart = () => {
    heard = true;
    const ms = Date.now() - session.startedAt;
    vlog(`audiostart ${ms}ms`);
    // 2026-10-10 の記録: 前の回の直後(約1分以内)は、押してから0.1秒もたたずにマイクが開いた合図が来て、声は届かない。
    // 正常なときは0.25秒以上かかる。速すぎるときは使えないマイクとみて、すぐ止めて知らせる(赤いまま待たせない)
    if (mine() && ms < 100 && rec === r) {
      vlog('使えないマイクと判定して止める');
      rec = null;
      try { r.abort(); } catch { /* 既に止まっている */ }
      notify();
      errorHandler(BUSY);
    }
  };
  r.onsoundstart = () => vlog('soundstart');
  r.onsoundend = () => vlog('soundend');
  r.onspeechend = () => vlog('speechend');
  r.onaudioend = () => vlog('audioend');
  r.onnomatch = () => vlog('nomatch');
  // 声を拾ったのに文字が5秒たっても出てこないときは、止めて知らせる(物音では数えず、声のときだけ)
  r.onspeechstart = () => {
    vlog('speechstart');
    heard = true;
    if (!mine() || session.gotResult || soundTimer) return;
    soundTimer = setTimeout(() => {
      if (session.gotResult || rec !== r || !mine()) return;
      vlog('見張り: 声を拾って5秒文字なし');
      rec = null;
      try { r.abort(); } catch { /* 既に止まっている */ }
      notify();
      errorHandler(NO_TEXT);
    }, 5000);
  };
  // 3秒たってもマイクが開かなければ(黙っているだけなら止めない)、赤いままにせず止めて知らせる
  watchdog = setTimeout(() => {
    if (heard || rec !== r || !mine()) return;
    vlog('見張り: 3秒マイク開かず');
    rec = null;
    try { r.abort(); } catch { /* 既に止まっている */ }
    notify();
    errorHandler('音声入力が始まりませんでした。もう一度マイクを押してください');
  }, 3000);
  // 音声入力中に手で入力・修正したら(キーボードでの入力は isTrusted が true)、それを土台にして続きを足す
  const onType = (ev) => {
    if (!ev.isTrusted || rec !== r || !mine()) return;
    baseText = textarea.value;
    consumed = lastFull.length;
    vlog('音声入力中に手で入力');
  };
  textarea.addEventListener('input', onType);
  rec = r;
  if (running) {
    // 前の回がまだ終わっていない。止めて、終わったところで始める
    vlog('前の回が動作中なので終わりを待つ');
    queued = textarea;
    current = null;
    try { r.abort(); } catch { /* 既に止まっている */ }
    notify();
    return true;
  }
  try {
    r.start();
    running = true;
  } catch (e) {
    vlog(`start失敗 ${e.name} ${e.message}`);
    rec = null;
    errorHandler(`音声認識を開始できません(${e.message})`);
  }
  notify();
  return true;
}

function stopNow() {
  const r = rec;
  rec = null;
  try { r.abort(); } catch { /* 既に止まっている */ }
  notify();
}

// 止めて、最後の言葉が入力欄に届くのを待つ
export function stop() {
  if (!rec) return Promise.resolve();
  vlog('stop(保存・画面切替など)');
  const r = rec;
  return new Promise((resolve) => {
    const done = () => resolve();
    r.addEventListener('end', done, { once: true });
    setTimeout(done, 1500); // endが来ない端末への保険
    rec = null;
    // stop ではなく abort で止める。画面に出ている文字は残る。stop だとマイクが長く残る疑いがあるため(2026-10-10)
    try { r.abort(); } catch { done(); }
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
