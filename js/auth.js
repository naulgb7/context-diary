// Googleログイン(Google Identity Services)。トークンは1時間で切れるので、切れたら再接続を促す
import { CLIENT_ID, SCOPE } from '../config.js';
import { lsGet, lsSet } from './settings.js';

let token = null;
let expiresAt = 0;
let client = null;
const listeners = new Set();

export class AuthError extends Error {}

// 前回のトークンがまだ有効なら使う(ホーム画面から開き直したとき、ログインし直さずに済む)
(() => {
  const t = lsGet('gToken');
  const exp = Number(lsGet('gTokenExp') || 0);
  if (t && exp > Date.now() + 60000) {
    token = t;
    expiresAt = exp;
  }
})();

export const isSignedIn = () => !!token && expiresAt > Date.now() + 30000;
export const getToken = () => (isSignedIn() ? token : null);
export const onAuthChange = (fn) => listeners.add(fn);
const notify = () => listeners.forEach((fn) => fn(isSignedIn()));

export function clearToken() {
  token = null;
  expiresAt = 0;
  lsSet('gToken', null);
  lsSet('gTokenExp', null);
  notify();
}

// ボタンを押したときに呼ぶ(ログイン画面は利用者の操作からしか開けない)
export function signIn() {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) {
      reject(new Error('Googleのログイン部品を読み込めていません。電波を確かめて、少し待ってから押してください'));
      return;
    }
    if (!client) {
      client = google.accounts.oauth2.initTokenClient({ client_id: CLIENT_ID, scope: SCOPE, callback: () => {} });
    }
    client.callback = (resp) => {
      if (resp.error) {
        reject(new Error(`ログインできませんでした(${resp.error})`));
        return;
      }
      token = resp.access_token;
      expiresAt = Date.now() + Number(resp.expires_in) * 1000;
      lsSet('gToken', token);
      lsSet('gTokenExp', String(expiresAt));
      notify();
      resolve();
    };
    client.error_callback = (err) => reject(new Error(`ログイン画面を開けませんでした(${err.type})`));
    client.requestAccessToken({ prompt: '' });
  });
}

export function signOut() {
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
  clearToken();
}
