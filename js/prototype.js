// 試作: iPhoneのホーム画面版で Googleログイン→ドライブ書き込み と 音声入力 が動くかを確かめる
import { CLIENT_ID, SCOPE, FOLDER_NAME } from '../config.js';

const $ = (id) => document.getElementById(id);
const logEl = $('log');

function log(msg, cls) {
  const t = new Date().toLocaleTimeString('ja-JP');
  const line = document.createElement('span');
  if (cls) line.className = cls;
  line.textContent = `[${t}] ${msg}\n`;
  logEl.appendChild(line);
}

// ---- 1) 環境 ----
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
$('env').innerHTML = [
  `起動方法: ${standalone ? 'ホーム画面から(standalone)' : 'ブラウザのタブ'}`,
  `音声認識の機能: ${SR ? 'あり' : 'なし'}`,
  `ブラウザ: ${navigator.userAgent}`,
].map((s) => `<div>${s.replace(/</g, '&lt;')}</div>`).join('');
log(`起動方法=${standalone ? 'standalone' : 'browser'} / 音声認識=${SR ? 'あり' : 'なし'}`);

// ---- 2) Googleログインとドライブ書き込み ----
let accessToken = null;
let tokenClient = null;

function initTokenClient() {
  if (tokenClient) return true;
  if (!window.google?.accounts?.oauth2) {
    log('Googleのログイン部品がまだ読み込まれていません。数秒待ってからもう一度押してください', 'ng');
    return false;
  }
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    callback: (resp) => {
      if (resp.error) {
        log(`ログイン失敗: ${resp.error} ${resp.error_description || ''}`, 'ng');
        return;
      }
      accessToken = resp.access_token;
      $('write').disabled = false;
      log(`ログイン成功(有効期限 ${resp.expires_in} 秒)`, 'ok');
    },
    error_callback: (err) => {
      log(`ログイン画面のエラー: ${err.type} ${err.message || ''}`, 'ng');
    },
  });
  return true;
}

$('login').addEventListener('click', () => {
  if (!initTokenClient()) return;
  log('ログイン画面を開きます');
  tokenClient.requestAccessToken({ prompt: '' });
});

async function driveFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, ...(options.headers || {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

async function findOrCreateFolder() {
  const q = encodeURIComponent(
    `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false`
  );
  const found = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
  if (found.files.length > 0) return found.files[0].id;
  const created = await driveFetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  log(`フォルダ「${FOLDER_NAME}」を作成しました`);
  return created.id;
}

async function writeTestFile() {
  const folderId = await findOrCreateFolder();
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const name = `試作_${stamp}_${standalone ? 'standalone' : 'browser'}.md`;
  const body = `# 試作の書き込み\n\n${now.toLocaleString('ja-JP')}\n\n${$('text').value || '(本文なし)'}\n`;

  const boundary = 'cd' + Math.random().toString(36).slice(2);
  const multipart =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ name, parents: [folderId], mimeType: 'text/markdown' }) +
    `\r\n--${boundary}\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n` +
    body +
    `\r\n--${boundary}--`;

  const file = await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipart,
  });
  log(`ドライブに書き込み成功: ${FOLDER_NAME}/${file.name}`, 'ok');
}

$('write').addEventListener('click', async () => {
  $('write').disabled = true;
  try {
    await writeTestFile();
  } catch (e) {
    log(`書き込み失敗: ${e.message}`, 'ng');
  } finally {
    $('write').disabled = false;
  }
});

// ---- 3) 音声入力 ----
let rec = null;
let listening = false;
let baseText = '';

function setMic(on) {
  listening = on;
  $('mic').classList.toggle('on', on);
  $('micState').textContent = on ? '聞き取り中(もう一度押すと止まる)' : '停止中';
}

$('mic').addEventListener('click', () => {
  if (!SR) {
    log('このブラウザには音声認識の機能がありません。入力欄を選んでキーボードのマイクを使ってください', 'ng');
    $('text').focus();
    return;
  }
  if (listening) {
    rec.stop();
    return;
  }
  rec = new SR();
  rec.lang = 'ja-JP';
  rec.interimResults = true;
  rec.continuous = true;
  baseText = $('text').value;

  rec.onstart = () => { setMic(true); log('音声認識を開始しました'); };
  rec.onresult = (ev) => {
    let finalText = '';
    let interim = '';
    for (let i = 0; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    $('text').value = baseText + finalText + interim;
  };
  rec.onerror = (ev) => { log(`音声認識のエラー: ${ev.error}`, 'ng'); };
  rec.onend = () => {
    setMic(false);
    const got = $('text').value.length > baseText.length;
    log(got ? '音声認識を終了(文字が入りました)' : '音声認識を終了(文字は入りませんでした)', got ? 'ok' : 'ng');
  };
  try {
    rec.start();
  } catch (e) {
    log(`音声認識を開始できません: ${e.message}`, 'ng');
  }
});

// ---- 記入ボタン: 音声入力を止めてドライブに書き、入力欄を空にする ----
$('save').addEventListener('click', async () => {
  if (listening) {
    // 止めた直後に最後の文字が届くので、終了を待ってから書く
    await new Promise((resolve) => {
      rec.addEventListener('end', resolve, { once: true });
      rec.stop();
    });
  }
  if (!$('text').value.trim()) {
    log('入力欄が空です', 'ng');
    return;
  }
  if (!accessToken) {
    log('先に「Googleにログイン」を押してください', 'ng');
    return;
  }
  $('save').disabled = true;
  try {
    await writeTestFile();
    $('text').value = '';
  } catch (e) {
    log(`書き込み失敗: ${e.message}`, 'ng');
  } finally {
    $('save').disabled = false;
  }
});

// ---- 記録のコピー ----
$('copy').addEventListener('click', async () => {
  const text = `${$('env').innerText}\n\n${logEl.innerText}`;
  try {
    await navigator.clipboard.writeText(text);
    log('記録をコピーしました', 'ok');
  } catch {
    log('コピーできませんでした。記録を長押しして選択してください', 'ng');
  }
});
