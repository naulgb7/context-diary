// Googleドライブの読み書き(権限 drive.file = このアプリが作ったファイルだけ)
import { FOLDER_NAME } from '../config.js';
import { getToken, clearToken, AuthError } from './auth.js';
import { kvGet, kvSet } from './store.js';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

async function call(url, options = {}, as = 'json') {
  const token = getToken();
  if (!token) throw new AuthError('Googleに接続していません');
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  if (res.status === 401) {
    clearToken();
    throw new AuthError('Googleの接続が切れました');
  }
  if (!res.ok) throw new Error(`ドライブ ${res.status}: ${(await res.text()).slice(0, 200)}`);
  if (as === 'text') return res.text();
  if (res.status === 204) return null;
  return res.json();
}

const q = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export async function listFiles(query, fields = 'id,name,modifiedTime') {
  let out = [];
  let pageToken = '';
  do {
    const url = `${API}/files?q=${encodeURIComponent(query)}&fields=nextPageToken,files(${fields})&pageSize=1000&orderBy=createdTime` +
      (pageToken ? `&pageToken=${pageToken}` : '');
    const r = await call(url);
    out = out.concat(r.files);
    pageToken = r.nextPageToken || '';
  } while (pageToken);
  return out;
}

export const findByName = (name, parentId) =>
  listFiles(`name='${q(name)}' and '${parentId}' in parents and trashed=false`);

// フォルダを探し、なければ作る。idは端末に覚えておく
async function folder(name, parentId, cacheKey) {
  const cached = await kvGet(cacheKey);
  if (cached) return cached;
  const found = await listFiles(`name='${q(name)}' and mimeType='${FOLDER_MIME}' and '${parentId}' in parents and trashed=false`);
  let id;
  if (found.length) id = found[0].id;
  else {
    const r = await call(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    });
    id = r.id;
  }
  await kvSet(cacheKey, id);
  return id;
}

export const rootFolder = () => folder(FOLDER_NAME, 'root', 'folder:root');
export const diaryFolder = async () => folder('日記', await rootFolder(), 'folder:diary');
export const yearFolder = async (year) => folder(String(year), await diaryFolder(), `folder:diary:${year}`);
export const logFolder = async () => folder('問いログ', await rootFolder(), 'folder:log');

// フォルダが消された等でidが無効になったとき、覚えたidを捨てる
export async function forgetFolders() {
  for (const k of ['folder:root', 'folder:diary', 'folder:log']) await kvSet(k, null);
  const y = new Date().getFullYear();
  for (let i = y - 5; i <= y + 1; i++) await kvSet(`folder:diary:${i}`, null);
}

export const readText = (id) => call(`${API}/files/${id}?alt=media`, {}, 'text');

export async function createFile(name, parentId, text, mime) {
  const boundary = 'cd' + Math.random().toString(36).slice(2);
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ name, parents: [parentId], mimeType: mime }) +
    `\r\n--${boundary}\r\nContent-Type: ${mime}; charset=UTF-8\r\n\r\n` +
    text +
    `\r\n--${boundary}--`;
  return call(`${UPLOAD}/files?uploadType=multipart&fields=id,modifiedTime`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
}

export const updateFile = (id, text, mime) =>
  call(`${UPLOAD}/files/${id}?uploadType=media&fields=id,modifiedTime`, {
    method: 'PATCH',
    headers: { 'Content-Type': `${mime}; charset=UTF-8` },
    body: text,
  });

export const trashFile = (id) =>
  call(`${API}/files/${id}?fields=id`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });
