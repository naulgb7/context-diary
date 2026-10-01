// まとめの通知(Webプッシュ)の受け取り設定。
// 購読情報をドライブの 通知購読.json に書き、PCの送信プログラム(通知\send-push.js)がそれを読んで送る
import { VAPID_PUBLIC_KEY } from '../config.js';
import * as drive from './drive.js';
import { lsGet, lsSet } from './settings.js';
import { device } from './util.js';

const FILE = '通知購読.json';

export const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// この端末を見分ける名前(購読情報の上書きに使う)
function deviceId() {
  let id = lsGet('pushDeviceId');
  if (!id) {
    id = `${device}-${Math.random().toString(36).slice(2, 8)}`;
    lsSet('pushDeviceId', id);
  }
  return id;
}

function keyBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function currentSubscription() {
  if (!supported) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

async function updateFile(fn) {
  const root = await drive.rootFolder();
  const files = await drive.findByName(FILE, root);
  let data = { subscriptions: [] };
  if (files.length) {
    try { data = JSON.parse(await drive.readText(files[0].id)); } catch { /* 壊れていたら作り直す */ }
  }
  data.subscriptions = fn(data.subscriptions || []);
  const text = JSON.stringify(data, null, 2);
  if (files.length) await drive.updateFile(files[0].id, text, 'application/json');
  else await drive.createFile(FILE, root, text, 'application/json');
}

// 通知の許可は、ボタンを押した処理の中で最初に求める(iPhoneはそうしないと許可画面が出ない)
export async function enable() {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('通知が許可されませんでした。iPhoneの「設定 → 通知 → 日記」で許可できます');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
  const id = deviceId();
  await updateFile((list) => [
    ...list.filter((s) => s.device !== id && s.subscription?.endpoint !== sub.endpoint),
    { device: id, subscription: sub.toJSON(), updatedAt: new Date().toISOString() },
  ]);
}

export async function disable() {
  const sub = await currentSubscription();
  const id = deviceId();
  await updateFile((list) => list.filter((s) => s.device !== id && (!sub || s.subscription?.endpoint !== sub.endpoint)));
  if (sub) await sub.unsubscribe();
}
