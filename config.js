// アプリの版。設定画面の一番下に出す(iPhoneに新しい版が届いたかの確認用)。直したら上げる
export const APP_VERSION = '2026-10-03.5';

// Google Cloud で発行したクライアントID(秘密情報ではない)
export const CLIENT_ID = '436391000512-neegb6o91iakqdik39o2s6uba7pcsvp9.apps.googleusercontent.com';

// このアプリが作ったファイルだけ読み書きできる権限
export const SCOPE = 'https://www.googleapis.com/auth/drive.file';

// Webプッシュの公開鍵(秘密鍵はPCの 通知\vapid.json にだけある)
export const VAPID_PUBLIC_KEY = 'BKdE_Ih2Zj4gWJytzA2CIuJyliK6jRrR2rTQcXnhwRbUO4Qo1GC6QNy5lmuFbNntJTMdc-n9vkY4cgGecB8VF7A';

// マイドライブ直下に作るフォルダ名
export const FOLDER_NAME = 'コンテキスト日記';
