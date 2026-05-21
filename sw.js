// Poligonal CR — Service Worker con auto-actualización
// IMPORTANTE: cambiar este número con cada deploy
const VERSION = '10';
const CACHE = 'pcr-v' + VERSION;
const BASE = '/Calculo-poligonal-/';

const FILES = [
  BASE,
  BASE + 'index.html',
  BASE + 'topo.js',
  BASE + 'manifest.json',
  BASE + 'icon-192.png',
  BASE + 'icon-512.png'
];

// INSTALL: cachear archivos nuevos
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(FILES))
      .then(() => self.skipWaiting()) // activa inmediatamente sin esperar
  );
});

// ACTIVATE: borrar cachés viejos
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => {
          console.log('Borrando caché viejo:', k);
          return caches.delete(k);
        })
      ))
      .then(() => self.clients.claim()) // tomar control de todas las pestañas
  );
});

// FETCH: network first para HTML/JS, cache first para imágenes
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const isStatic = e.request.url.match(/\.(png|jpg|ico)$/);

  if (isStatic) {
    // Imágenes: caché primero
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request))
    );
  } else {
    // HTML/JS: red primero, si falla usa caché
    e.respondWith(
      fetch(e.request)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE).then(cache => cache.put(e.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(e.request)
          .then(cached => cached || caches.match(BASE + 'index.html'))
        )
    );
  }
});
