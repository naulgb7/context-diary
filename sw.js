// オフラインでも開けるようにアプリ本体を端末に保存する。
// 電波があるときは常に最新を取りに行き(3秒で諦めて保存版を使う)、更新がすぐ反映されるようにする
const CACHE = 'context-diary-v29';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'config.js', 'css/app.css',
  'js/app.js', 'js/util.js', 'js/store.js', 'js/settings.js', 'js/auth.js', 'js/drive.js', 'js/markdown.js',
  'js/sync.js', 'js/questions.js', 'js/gemini.js', 'js/voice.js', 'js/ui.js', 'js/push.js',
  'js/views/write.js', 'js/views/summary.js', 'js/views/browse.js', 'js/views/settings.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // Google等の通信には関わらない
  e.respondWith(networkFirst(req));
});

// まとめの通知(PCの send-push.js から届く)
self.addEventListener('push', (e) => {
  let data = { title: 'コンテキスト日記', body: '' };
  try { data = { ...data, ...e.data.json() }; } catch { if (e.data) data.body = e.data.text(); }
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: 'summary-reminder',
    renotify: true,
  }));
});

// 通知を押したら、日記アプリを1日のまとめの画面で開く(開いていれば前に出してまとめの画面へ)
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = list.find((c) => c.url.startsWith(self.registration.scope));
    if (app) {
      app.postMessage({ type: 'open-summary' });
      return app.focus();
    }
    return self.clients.openWindow(self.registration.scope + '#summary');
  })());
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([
      // ブラウザ側の保存(GitHub Pagesは10分保存させる)を使わず、毎回新しい版があるか確かめる
      fetch(req, { cache: 'no-cache' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
    return Response.error();
  }
}
