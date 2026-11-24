/**
 * ============================================================================
 * FOLIO SERVICE WORKER - OFFLINE-FIRST CACHE ENGINE
 * Memungkinkan aplikasi terbuka dan beroperasi 100% offline tanpa internet
 * ============================================================================
 */

const CACHE_NAME = 'folio-cache-v2';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './config.js',
  './supabase_adapter.js',
  './manifest.json',
  './Foliologo.jpg',
  './vendor/tailwind.js',
  './vendor/chart.umd.js',
  './vendor/lucide.min.js',
  './vendor/fonts.css',
  ...Array.from({ length: 24 }, (_, i) => `./vendor/fonts/plus-jakarta-sans-${i}.woff2`)
];

// 1. INSTALL: Precache seluruh aset statis
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => {
        console.warn('Gagal precache beberapa aset:', err);
        return self.skipWaiting();
      })
  );
});

// 2. ACTIVATE: Bersihkan cache versi lama dan klaim kontrol client
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('Menghapus cache lawas:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. FETCH: Strategi Cache-First untuk aset lokal, Network-First untuk navigasi HTML,
//    dan Bypass untuk request API Supabase / GAS / Exchange (ditangani IndexedDB)
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = req.url;

  // Jangan intercept request API (Supabase, Google Apps Script, Exchange rate)
  if (
    url.includes('supabase.co') ||
    url.includes('script.google.com') ||
    url.includes('open.er-api.com')
  ) {
    return;
  }

  // Navigasi HTML: Network-first, fallback ke cache index.html jika offline
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const clone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return networkRes;
        })
        .catch(() => {
          return caches.match(req).then((cached) => cached || caches.match('./index.html') || caches.match('/'));
        })
    );
    return;
  }

  // Aset Statis (CSS, JS, Fonts, Gambar): Cache-First dengan Network Fallback
  event.respondWith(
    caches.match(req).then((cachedRes) => {
      if (cachedRes) return cachedRes;

      return fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const clone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return networkRes;
        })
        .catch(() => {
          // Fallback offline untuk gambar jika gagal dimuat
          if (req.destination === 'image') {
            return caches.match('./Foliologo.jpg');
          }
        });
    })
  );
});
