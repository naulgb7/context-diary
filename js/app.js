// 起動と画面の切り替え
import { $, $$ } from './util.js';
import { loadSettings } from './settings.js';
import { isSignedIn, signIn, onAuthChange } from './auth.js';
import { requestSync, onSyncState, refreshPending } from './sync.js';
import * as voice from './voice.js';
import { ICONS, toast, show, back, viewName } from './ui.js';
import { initWrite, refresh as refreshWrite } from './views/write.js';
import { initSummary, openSummary } from './views/summary.js';
import { initBrowse } from './views/browse.js';
import { initSettings } from './views/settings.js';

function setupIcons() {
  for (const el of $$('[data-icon]')) el.innerHTML = ICONS[el.dataset.icon];
  // 音声認識が使えない端末では、記入タブを鉛筆にしてマイクを出さない(キーボードの音声入力を使う)
  $('#tabWriteIcon').innerHTML = voice.available ? ICONS.mic : ICONS.pencil;
  for (const b of $$('.mic')) {
    b.innerHTML = ICONS.mic;
    if (!voice.available) b.closest('.micwrap').hidden = true;
  }
}

// 入力欄の中でのカーソルの縦位置(欄の先頭からの距離)を、同じ書式の見えない写しで測る
function caretY(ta) {
  const cs = getComputedStyle(ta);
  const div = document.createElement('div');
  for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'boxSizing']) {
    div.style[p] = cs[p];
  }
  Object.assign(div.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', width: `${ta.clientWidth + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth)}px`, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'break-word', borderStyle: 'solid' });
  div.textContent = ta.value.slice(0, ta.selectionStart);
  const mark = document.createElement('span');
  mark.textContent = '|';
  div.appendChild(mark);
  document.body.appendChild(div);
  const y = mark.offsetTop;
  div.remove();
  return y;
}

function setupVoice() {
  for (const b of $$('.mic')) {
    // clickの中で同期的に開始する(iPhoneはそうしないと音声認識を始められない)
    b.addEventListener('click', () => voice.toggle($('#' + b.dataset.micFor)));
  }
  // 入力欄は中身に合わせて高さを伸ばす(入力欄の中だけのスクロールはiPhoneで動かしにくいため、画面ごと送る)。
  // 音声入力や改行ボタンで文が増えたときは、文の最後とマイク・記入ボタンが見える位置まで画面を送る。
  // 末尾の改行は見えないので、改行したことを入力欄の下に表示する
  for (const ta of [$('#writeText'), $('#sumText')]) {
    const hint = $(`.nlhint[data-hint-for="${ta.id}"]`);
    const ops = ta.parentElement.querySelector('.ops');
    // キーボードで直している間は、入力欄をキーボードの上に収まる高さにして、欄の中でスクロールさせる。
    // 伸びたままだとカーソルの行がキーボードの下に隠れるため
    const fitKeyboard = () => {
      if (document.activeElement !== ta) return;
      const headerH = $('.top').offsetHeight;
      const vv = window.visualViewport;
      const visible = vv ? vv.height : window.innerHeight;
      ta.style.overflowY = 'auto';
      // 欄を縮めるとページが短くなって送った位置が戻ってしまうので、入力中は下に余白を足しておく
      document.body.classList.add('kb');
      // 欄の上端をタイトルのすぐ下へ送り、実際の上端からキーボードの上端までに収まる高さにする
      window.scrollBy(0, ta.getBoundingClientRect().top - headerH - 8);
      const top = ta.getBoundingClientRect().top - (vv?.offsetTop || 0);
      ta.style.height = `${Math.max(100, visible - top - 12)}px`;
      // 欄を縮めるとタップした位置のカーソルが欄の外に出るので、カーソルの行が欄の中ほどに来るよう送る
      const y = caretY(ta);
      if (y < ta.scrollTop + 8 || y > ta.scrollTop + ta.clientHeight - 40) {
        ta.scrollTop = Math.max(0, y - ta.clientHeight / 2);
      }
      // iPhoneは入力中の欄の高さやスクロールを変えるとカーソルの表示が消えるので、選択位置を入れ直して描き直させる
      const { selectionStart: s, selectionEnd: e } = ta;
      requestAnimationFrame(() => { if (document.activeElement === ta) ta.setSelectionRange(s, e); });
    };
    const update = () => {
      hint.hidden = !ta.value.endsWith('\n');
      // キーボードで入力している間は、欄の大きさもカーソルも触らない(日本語の変換中に触ると変換が壊れる)。
      // 欄を合わせるのは、キーボードが出たときと大きさが変わったときだけ
      if (document.activeElement === ta) return;
      document.body.classList.remove('kb');
      ta.style.overflowY = '';
      ta.style.height = 'auto';
      ta.style.height = `${Math.max(140, ta.scrollHeight + 2)}px`;
      if (!ta.closest('.view').hidden) {
        const limit = window.innerHeight - $('.tabs').offsetHeight - 8;
        const bottom = ops.getBoundingClientRect().bottom;
        if (bottom > limit) window.scrollBy(0, bottom - limit);
      }
    };
    ta.addEventListener('input', update);
    ta.addEventListener('change', update);
    ta.addEventListener('focus', () => setTimeout(fitKeyboard, 350)); // キーボードが出きってから合わせる
    ta.addEventListener('blur', () => setTimeout(update, 50));
    window.visualViewport?.addEventListener('resize', fitKeyboard);
    ta.updateHint = update; // 画面側で値を入れ替えたときに呼ぶ
  }
  for (const b of $$('.nl')) {
    b.addEventListener('pointerdown', (e) => e.preventDefault()); // 押しても入力欄の選択(カーソル位置)を外さない
    b.addEventListener('click', () => voice.newline($('#' + b.dataset.nlFor)));
  }
  voice.onVoiceState((on, target) => {
    for (const b of $$('.mic')) b.classList.toggle('on', on && target?.id === b.dataset.micFor);
    for (const s of $$('.micstate')) s.textContent = on && target?.id === s.dataset.stateFor ? '聞き取り中' : '停止中';
    $('#tabWrite').classList.toggle('listening', on);
  });
  voice.onVoiceError((msg) => toast(msg, 7000));
}

function setupTabs() {
  // 記入タブ: 押すとすぐ音声入力。記入画面(まとめ画面)にいるときは、その入力欄で開始/停止
  $('#tabWrite').addEventListener('click', () => {
    const name = viewName();
    if (!voice.available) {
      if (name !== 'summary') show('write');
      $(name === 'summary' ? '#sumText' : '#writeText').focus();
      return;
    }
    if (name === 'summary') return voice.toggle($('#sumText'));
    if (name === 'write') return voice.toggle($('#writeText'));
    show('write');
    voice.start($('#writeText'));
  });
  $('#backBtn').addEventListener('click', () => back());
  for (const b of $$('.tabs button[data-tab]:not(#tabWrite)')) {
    b.addEventListener('click', async () => {
      await voice.stop();
      show(b.dataset.tab);
    });
  }
}

function setupSyncButton() {
  const btn = $('#syncBtn');
  onSyncState((s) => {
    btn.classList.remove('warn', 'ok');
    const pend = s.pending ? ` ${s.pending}件` : '';
    if (s.phase === 'signedOut') { btn.textContent = `Googleに接続${s.pending ? `(未送信${pend})` : ''}`; btn.classList.add('warn'); }
    else if (s.phase === 'offline') btn.textContent = `オフライン${s.pending ? `(未送信${pend})` : ''}`;
    else if (s.phase === 'syncing') btn.textContent = '同期中…';
    else if (s.phase === 'error') { btn.textContent = `同期エラー${pend ? `(未送信${pend})` : ''}`; btn.classList.add('warn'); }
    else if (s.pending) btn.textContent = `未送信${pend}`;
    else { btn.textContent = '保存済み'; btn.classList.add('ok'); }
    btn.title = s.message || '';
  });
  btn.addEventListener('click', async () => {
    if (!isSignedIn()) {
      try { await signIn(); } catch (e) { toast(e.message, 6000); return; }
    }
    requestSync();
  });
  onAuthChange(() => requestSync());
}

// iPhoneはSafariとホーム画面のアプリで保存場所が別。Safariで開いたときは知らせる
function checkStandalone() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  $('#browserNotice').hidden = standalone || !/iPhone|iPad|iPod/.test(navigator.userAgent);
}

async function main() {
  checkStandalone();
  await loadSettings();
  setupIcons();
  setupVoice();
  setupTabs();
  setupSyncButton();
  initWrite();
  initSummary();
  initBrowse();
  initSettings();
  show('write');

  window.addEventListener('online', () => requestSync());
  window.addEventListener('offline', () => refreshPending().then(() => requestSync()));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      requestSync();
      if (viewName() === 'write') refreshWrite();
    }
  });
  requestSync().then(() => { if (viewName() === 'write') refreshWrite(); });

  // まとめの通知から開いたとき(#summary 付き、または開いていたアプリへの知らせ)は、まとめの画面にする
  if (location.hash === '#summary') {
    history.replaceState(null, '', location.pathname);
    openSummary();
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service Worker', e));
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'open-summary') openSummary();
    });
  }
}

main().catch((e) => {
  console.error(e);
  toast(`起動できませんでした: ${e.message}`, 10000);
});
