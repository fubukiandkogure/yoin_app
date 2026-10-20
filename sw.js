// アプリのファイルは常に最新を取りに行き（更新直後に古いファイルが混ざらないように）、
// 通信できないときだけ前回の控えを使う（オフラインでも記録を見られるように）。
// 記録データや外部APIへの通信には手を出さない（同じサイトのファイルだけを扱う）。
const CACHE = 'yoin-app-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      // HTTP キャッシュを使わず、サーバーに更新を確認する（変わっていなければ 304 で軽い）
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok && res.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
      }
      return res;
    } catch (e) {
      const hit = await caches.match(req);
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const index = await caches.match('./') || await caches.match('./index.html');
        if (index) return index;
      }
      throw e;
    }
  })());
});
