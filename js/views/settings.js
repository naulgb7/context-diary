// 設定画面
import { $, esc } from '../util.js';
import { settings, updateSettings, onSettingsChange, MAX_SUMMARY_QUESTIONS, getGeminiKey, setGeminiKey, getGeminiModel } from '../settings.js';
import { isSignedIn, signIn, signOut, onAuthChange } from '../auth.js';
import { requestSync, onSyncState } from '../sync.js';
import { generateQuestion, resetModel } from '../gemini.js';
import { nextQuestion } from '../questions.js';
import { toast, onShow } from '../ui.js';
import * as push from '../push.js';
import { APP_VERSION } from '../../config.js';

// 画面で編集中の一覧(空欄の行も残しておき、保存するときに空欄を除く)
let summaryQs = [];
let randomItems = [];
let syncInfo = { phase: 'idle', pending: 0 };

export function initSettings() {
  onShow((name) => { if (name === 'settings') render(); });
  onSettingsChange(() => { if (!$('#view-settings').hidden && !$('#view-settings').contains(document.activeElement)) render(); });
  onAuthChange(() => { if (!$('#view-settings').hidden) renderAccount(); });
  onSyncState((s) => { syncInfo = s; if (!$('#view-settings').hidden) renderAccount(); });
}

function render() {
  const s = settings();
  summaryQs = [...s.summaryQuestions];
  randomItems = s.randomItems.map((i) => ({ ...i }));
  $('#view-settings').innerHTML = `
    <div class="set" id="setAccount"></div>

    <div class="set" id="setPush"></div>

    <div class="set">
      <h2>1日のまとめ</h2>
      <div class="row"><span>ボタンを出す時刻</span><input type="time" id="setSumStart" value="${esc(s.summaryStartTime)}"></div>
      <p>まとめの問い(<span id="sumCount"></span>/${MAX_SUMMARY_QUESTIONS})。上から順に出ます。</p>
      <div id="sumList"></div>
      <button type="button" class="sub" id="sumAdd">問いを追加</button>
    </div>

    <div class="set">
      <h2>ランダムの問い(随時の記入)</h2>
      <label class="radio"><input type="radio" name="rmode" value="list" ${s.randomMode === 'list' ? 'checked' : ''}>登録した問い集から抽選する</label>
      <label class="radio"><input type="radio" name="rmode" value="ai" ${s.randomMode === 'ai' ? 'checked' : ''}>AIが作る(項目をテーマとして言い換える)</label>
      <p class="note">チェックを外した項目は出ません。直近に出た項目は、一巡するまで出しません。</p>
      <div id="rndList"></div>
      <button type="button" class="sub" id="rndAdd">項目を追加</button>
    </div>

    <div class="set">
      <h2>AI(Gemini API)</h2>
      <p class="note">APIキーはこの端末にだけ保存し、ドライブには送りません。PCとiPhoneで別々に入れてください。AIに送るのはテーマ・日時・曜日だけで、日記の本文は送りません。</p>
      <div class="row"><input type="password" id="setGemKey" placeholder="APIキーを貼り付け" value="${esc(getGeminiKey())}" autocomplete="off"><button type="button" id="setGemSave">保存</button></div>
      <div class="row"><button type="button" class="sub" id="setGemTest">試しに問いを作る</button><span class="note" id="gemModel"></span></div>
    </div>

    <div class="set">
      <h2>1日の切替時刻</h2>
      <p class="note">この時刻より前の記入は前の日の日記に入ります。「当日なら直せる」の判定にも使います。</p>
      <div class="row"><input type="time" id="setBoundary" value="${esc(s.dayBoundary)}"></div>
    </div>

    <div class="set">
      <h2>音声入力について</h2>
      <p class="note">iPhoneで音声認識の確認を一度「許可しない」にした場合は、「設定 → プライバシーとセキュリティ → 音声認識」で許可し、このアプリを閉じてから開き直してください。</p>
    </div>

    <p class="note" style="margin:18px 0 0">アプリの版: ${APP_VERSION}<br>試作(動作確認用)の画面: <a href="prototype.html">prototype.html</a></p>
  `;
  renderAccount();
  renderPush();
  renderSumList();
  renderRndList();
  $('#gemModel').textContent = getGeminiModel() ? `使うモデル: ${getGeminiModel().replace('models/', '')}` : '';

  $('#setSumStart').addEventListener('change', (e) => updateSettings({ summaryStartTime: e.target.value || '21:00' }));
  $('#setBoundary').addEventListener('change', (e) => updateSettings({ dayBoundary: e.target.value || '04:00' }).then(requestSync));
  $('#sumAdd').addEventListener('click', () => {
    if (summaryQs.length >= MAX_SUMMARY_QUESTIONS) return;
    summaryQs.push('');
    renderSumList(true);
  });
  $('#rndAdd').addEventListener('click', () => {
    randomItems.push({ text: '', enabled: true });
    renderRndList(true);
  });
  for (const r of document.querySelectorAll('input[name=rmode]')) {
    r.addEventListener('change', async () => {
      await updateSettings({ randomMode: r.value });
      if (r.value === 'ai' && !getGeminiKey()) toast('AIを使うには、下の欄にGemini APIキーを入れてください');
      await nextQuestion();
      requestSync();
    });
  }
  $('#setGemSave').addEventListener('click', () => {
    setGeminiKey($('#setGemKey').value);
    resetModel();
    toast($('#setGemKey').value.trim() ? 'APIキーを保存しました' : 'APIキーを消しました');
  });
  $('#setGemTest').addEventListener('click', async () => {
    const btn = $('#setGemTest');
    btn.disabled = true;
    try {
      setGeminiKey($('#setGemKey').value);
      const item = randomItems.find((i) => i.enabled && i.text.trim())?.text || '今日の出来事';
      const q = await generateQuestion(item);
      toast(`テーマ「${item}」→ ${q}`, 6000);
      $('#gemModel').textContent = `使うモデル: ${getGeminiModel().replace('models/', '')}`;
    } catch (e) {
      toast(`AIで問いを作れませんでした: ${e.message}`, 7000);
    } finally {
      btn.disabled = false;
    }
  });
}

function renderAccount() {
  const box = $('#setAccount');
  if (!box) return;
  const signed = isSignedIn();
  const phase = { idle: '同期済み', syncing: '同期中', offline: 'オフライン', error: '同期エラー', signedOut: '未接続' }[syncInfo.phase] || '';
  box.innerHTML = `
    <h2>Googleドライブ</h2>
    <p>${signed ? 'Googleに接続しています。' : 'Googleに接続していません(1時間ごとに接続が切れます。記入は端末に保存され、接続したときに送ります)。'}</p>
    <p class="note">状態: ${phase}${syncInfo.pending ? ` / 未送信 ${syncInfo.pending}件` : ''}${syncInfo.lastSync ? ` / 最後の同期 ${syncInfo.lastSync.toLocaleTimeString('ja-JP')}` : ''}${syncInfo.message ? `<br>${esc(syncInfo.message)}` : ''}</p>
    <div class="row">
      ${signed ? '<button type="button" id="accSync">今すぐ同期</button><button type="button" class="sub" id="accOut">ログアウト</button>' : '<button type="button" id="accIn">Googleに接続</button>'}
    </div>`;
  $('#accIn')?.addEventListener('click', async () => {
    try { await signIn(); requestSync(); } catch (e) { toast(e.message, 6000); }
  });
  $('#accOut')?.addEventListener('click', () => { signOut(); toast('ログアウトしました'); });
  $('#accSync')?.addEventListener('click', () => requestSync());
}

async function renderPush() {
  const box = $('#setPush');
  if (!box) return;
  const head = '<h2>まとめの通知</h2><p class="note">21時と22時に、1日のまとめが付いていなければ通知します(判定と送信はPCが行うので、PCが起動している必要があります)。</p>';
  if (!push.supported) {
    box.innerHTML = head + `<p>${/iPhone|iPad|iPod/.test(navigator.userAgent) && !push.standalone() ? 'ホーム画面の「日記」アイコンから開いたときに設定できます。' : 'この端末・ブラウザは通知に対応していません。'}</p>`;
    return;
  }
  const sub = await push.currentSubscription();
  const on = !!sub && Notification.permission === 'granted';
  box.innerHTML = head + `<p>この端末: ${on ? '通知を受け取る' : '通知を受け取らない'}</p>
    <div class="row">${on ? '<button type="button" class="sub" id="pushOff">通知を止める</button>' : '<button type="button" id="pushOn">この端末で通知を受け取る</button>'}</div>`;
  $('#pushOn')?.addEventListener('click', async () => {
    // 通知の許可画面とGoogleのログイン画面は、どちらも押した直後でないと開けないので、ログインは先に済ませてもらう
    if (!isSignedIn()) {
      toast('先に上の「Googleに接続」を押してから、もう一度押してください', 6000);
      return;
    }
    const btn = $('#pushOn');
    btn.disabled = true;
    try {
      await push.enable();
      toast('通知を受け取る設定にしました');
    } catch (e) {
      toast(e.message, 7000);
    }
    renderPush();
  });
  $('#pushOff')?.addEventListener('click', async () => {
    if (!isSignedIn()) {
      toast('先に上の「Googleに接続」を押してから、もう一度押してください', 6000);
      return;
    }
    try {
      await push.disable();
      toast('通知を止めました');
    } catch (e) {
      toast(e.message, 7000);
    }
    renderPush();
  });
}

function saveSummaryQs() {
  return updateSettings({ summaryQuestions: summaryQs.map((q) => q.trim()).filter(Boolean) });
}

function renderSumList(focusLast = false) {
  const box = $('#sumList');
  $('#sumCount').textContent = summaryQs.length;
  $('#sumAdd').disabled = summaryQs.length >= MAX_SUMMARY_QUESTIONS;
  box.innerHTML = summaryQs.map((q, i) => `
    <div class="row" data-i="${i}">
      <input type="text" value="${esc(q)}" placeholder="問いを入力">
      <button type="button" class="iconbtn" data-act="up" aria-label="上へ" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button type="button" class="iconbtn" data-act="down" aria-label="下へ" ${i === summaryQs.length - 1 ? 'disabled' : ''}>↓</button>
      <button type="button" class="iconbtn" data-act="del" aria-label="削除">×</button>
    </div>`).join('');
  for (const row of box.querySelectorAll('.row')) {
    const i = Number(row.dataset.i);
    const input = row.querySelector('input');
    input.addEventListener('input', () => { summaryQs[i] = input.value; });
    input.addEventListener('change', saveSummaryQs);
    for (const b of row.querySelectorAll('button')) {
      b.addEventListener('click', () => {
        if (b.dataset.act === 'up') [summaryQs[i - 1], summaryQs[i]] = [summaryQs[i], summaryQs[i - 1]];
        if (b.dataset.act === 'down') [summaryQs[i + 1], summaryQs[i]] = [summaryQs[i], summaryQs[i + 1]];
        if (b.dataset.act === 'del') summaryQs.splice(i, 1);
        renderSumList();
        saveSummaryQs().then(requestSync);
      });
    }
  }
  if (focusLast) box.querySelector('.row:last-child input')?.focus();
}

function saveRandomItems() {
  return updateSettings({ randomItems: randomItems.filter((i) => i.text.trim()).map((i) => ({ text: i.text.trim(), enabled: i.enabled })) });
}

function renderRndList(focusLast = false) {
  const box = $('#rndList');
  box.innerHTML = randomItems.map((it, i) => `
    <div class="row" data-i="${i}">
      <input type="checkbox" ${it.enabled ? 'checked' : ''} aria-label="有効">
      <input type="text" value="${esc(it.text)}" placeholder="問い(AIのときはテーマ)">
      <button type="button" class="iconbtn" data-act="del" aria-label="削除">×</button>
    </div>`).join('');
  for (const row of box.querySelectorAll('.row')) {
    const i = Number(row.dataset.i);
    const [check, input] = row.querySelectorAll('input');
    check.addEventListener('change', () => { randomItems[i].enabled = check.checked; saveRandomItems().then(requestSync); });
    input.addEventListener('input', () => { randomItems[i].text = input.value; });
    input.addEventListener('change', () => saveRandomItems().then(requestSync));
    row.querySelector('[data-act=del]').addEventListener('click', () => {
      randomItems.splice(i, 1);
      renderRndList();
      saveRandomItems().then(requestSync);
    });
  }
  if (focusLast) box.querySelector('.row:last-child input[type=text]')?.focus();
}
