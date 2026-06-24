const CACHE_NAME = 'sat-words-2020605a-pwa-v40';
const ASSETS = ['./','./index.html','./manifest.json','./barron3500.js','./icon-192.png','./icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(k => (
      k.startsWith('sat-2020605a-vocab-pwa-') ||
      k.startsWith('sat-words-2020605a-pwa-')
    ) && k !== CACHE_NAME)
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
