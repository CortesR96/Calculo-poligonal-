// TopoField Service Worker — Offline cache
const REPO = '/Calculo-poligonal';
const CACHE = 'topofield-v4';
const FILES = [
  REPO + '/',
  REPO + '/index.html',
  REPO + '/topo.js',
  REPO + '/manifest.json',
  REPO + '/icon-192.png',
  REPO + '/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => caches.match(REPO + '/index.html'));
    })
  );
});
