// SERVICE WORKER: guarda la app en el celular para que ABRA SIN INTERNET.
// Al publicar cambios, suba la VERSION: el celular descarga la nueva y borra la vieja.
const VERSION = 'dandinet-v1.12.0';
const ARCHIVOS = ['./', './index.html', './manifest.webmanifest', './css/tokens.css', './css/estilos.css',
  './js/app.js', './js/iconos.js', './js/api.js', './js/auth.js', './js/config.js', './js/datos.js', './js/db.js', './js/sync.js',
  './icons/icono-192.png', './icons/icono-512.png', './icons/icono-maskable-512.png', './icons/apple-touch-icon-180.png', './icons/favicon-32.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // solo archivos de la propia app; el API y Google siempre van a internet
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((enCache) => {
      const red = fetch(e.request).then((r) => {
        if (r && r.ok) caches.open(VERSION).then((c) => c.put(e.request, r.clone()));
        return r;
      }).catch(() => enCache || caches.match('./index.html'));
      return enCache || red;     // primero lo guardado (rápido y sin señal); se actualiza en segundo plano
    })
  );
});
