/* MeetLocal service worker: caches only this app's own static files so the app shell can open
 * offline. It never touches signaling (WebSocket is not interceptable), media, transcripts,
 * model files, or any cross-origin request. A call itself always needs the network. */
const CACHE = 'meetlocal-shell-v1';
const SKIP_PREFIXES = ['/ort/', '/mediapipe/', '/models/'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['/', '/manifest.webmanifest', '/favicon.svg'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (SKIP_PREFIXES.some((p) => url.pathname.startsWith(p))) return;
  if (url.pathname.endsWith('.wasm')) return;

  if (request.mode === 'navigate') {
    // Network first so a new deploy is picked up; fall back to the cached shell when offline.
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          if (response.ok) caches.open(CACHE).then((cache) => cache.put('/', copy));
          return response;
        })
        .catch(() => caches.match('/').then((cached) => cached || Response.error())),
    );
    return;
  }

  // Hashed build assets are immutable: cache first.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
