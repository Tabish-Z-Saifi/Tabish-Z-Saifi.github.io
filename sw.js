/* Service worker v2 — offline app shell.
   Strategy:
   - Same-origin GET → network-first, fall back to cache (so code updates arrive
     immediately, but the app still opens offline).
   - jsPDF CDN file → cache-first (versioned URL, never changes).
   - Firebase/Google endpoints → NOT intercepted. Firestore has its own offline
     persistence; interfering with auth/firestore requests breaks them.
*/
const CACHE = 'guest-list-v2';
const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './js/app.js',
  './js/store.js',
  './js/firebase.js',
  './js/config.js',
  JSPDF_URL
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(ASSETS.map(a => c.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // jsPDF CDN: cache-first (immutable versioned URL)
  if (url.href === JSPDF_URL) {
    e.respondWith(
      caches.match(e.request).then(c => c || fetch(e.request).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(cc => cc.put(e.request, copy)).catch(() => {});
        return resp;
      }))
    );
    return;
  }

  // Everything cross-origin (gstatic/firebase/google) — leave alone.
  if (url.origin !== location.origin) return;

  // Same-origin: network-first with cache fallback.
  e.respondWith(
    fetch(e.request).then(resp => {
      const copy = resp.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return resp;
    }).catch(() =>
      caches.match(e.request).then(c => c || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined))
    )
  );
});
