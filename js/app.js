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

function setupVoice() {
  for (const b of $$('.mic')) {
    // clickの中で同期的に開始する(iPhoneはそうしないと音声認識を始められない)
    b.addEventListener('click', () => voice.toggle($('#' + b.dataset.micFor)));
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
