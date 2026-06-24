const CACHE_NAME = 'sat-words-index-v20';
const ASSETS = ['./','./index.html'];
const OLD_CACHE_NAMES = ['sat-a-vocab-pwa-v1', 'sat-a-vocab-pwa-v2'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(k => OLD_CACHE_NAMES.includes(k) || (k.startsWith('sat-words-index-') && k !== CACHE_NAME))
    .map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html'))));
});
