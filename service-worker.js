// BiasharaStock service worker — app-shell caching so the app opens and
// works fully offline (products/sales are stored locally anyway).
// Only the AI endpoints (/api/parse-mpesa, /api/stock-insight) and payment
// endpoints need real network — those are left to fail normally with the
// existing "Could not reach the server" message when offline.

const CACHE_NAME = 'biasharastock-shell-v2';

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore-compat.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Never cache API calls (AI parsing, payments) — always hit the network.
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Let Firebase/Firestore/Auth backend traffic go straight to the network
  // — it manages its own offline queue/cache and must not be intercepted
  // here. (gstatic.com SDK script files are fine to cache as shell assets.)
  if (url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('firebaseapp.com')) {
    return;
  }

  const isKnownShellAsset = SHELL_ASSETS.includes(req.url);
  const isSameOrigin = url.origin === self.location.origin;

  // Cache-first for the app shell and static/CDN assets, with a network
  // fallback that also updates the cache for next time.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res && res.status === 200 && req.method === 'GET' && (isSameOrigin || isKnownShellAsset)) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => {
          // Navigating while offline with nothing cached yet — fall back
          // to the shell page so the app still opens.
          if (req.mode === 'navigate') return caches.match('./index.html');
        });
    })
  );
});
