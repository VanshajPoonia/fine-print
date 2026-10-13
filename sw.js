// Offline support. Once the model is cached (transformers.js keeps it in Cache Storage),
// Fine Print works with no connection at all, which is also the simplest proof that the
// contract never goes anywhere.
const SHELL = 'fp-shell-v1';
const RUNTIME = 'fp-runtime-v1';
const FILES = [
  './', 'index.html', 'assets/styles.css', 'assets/icon.svg', 'manifest.webmanifest',
  'src/app.js', 'src/embed.js', 'src/extract.js', 'src/flags.js', 'src/model.js', 'src/rules.js', 'src/scan.js', 'src/segment.js',
  'data/heads.json', 'data/samples/freelance.txt', 'data/samples/cuad.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('fp-') && k !== SHELL && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const sameOrigin = url.origin === location.origin;
  if (!sameOrigin && url.hostname !== 'cdn.jsdelivr.net') return; // model files: transformers.js caches those itself

  // Network first for our own files (so deploys show up), cache when offline.
  // Cache first for pinned library builds on jsDelivr.
  e.respondWith((async () => {
    const cache = await caches.open(sameOrigin ? SHELL : RUNTIME);
    if (!sameOrigin) {
      const hit = await cache.match(e.request);
      if (hit) return hit;
    }
    try {
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    } catch {
      return (await cache.match(e.request, { ignoreSearch: true })) || (await caches.match('index.html'));
    }
  })());
});
