/**
 * ============================================================
 *  SMART ABSEN ENTERPRISE v2.0 — SERVICE WORKER
 * ============================================================
 */

const CACHE_NAME = 'smart-absen-v2';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './absen.html',
  './absen.js',
  './master-admin.html',
  './master-admin.js',
  './config.js',
  './manifest.json',
];

// Install — cache semua aset utama
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Caching app assets...');
        return cache.addAll(ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate — bersihkan cache lama
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => {
        return Promise.all(
          keys.filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch — Network first, fallback to cache
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip Google API & Firebase requests (harus selalu fresh)
  const url = event.request.url;
  if (url.includes('googleapis.com') || 
      url.includes('firebaseio.com') || 
      url.includes('google.com')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache respons berhasil
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseClone);
        });
        return response;
      })
      .catch(() => {
        // Fallback ke cache jika offline
        return caches.match(event.request);
      })
  );
});

// Background sync untuk offline queue
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-attendance') {
    event.waitUntil(syncAttendanceData());
  }
});

async function syncAttendanceData() {
  // Notifikasi semua client untuk sync
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'SYNC_ATTENDANCE' });
  });
}

// Push notification handler
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const options = {
    body: data.body || 'Ada notifikasi baru dari Smart Absen',
    icon: './icon-192.png',
    badge: './icon-192.png',
    vibrate: [200, 100, 200],
    data: data.data || {},
    actions: data.actions || [],
  };
  event.waitUntil(
    self.registration.showNotification(data.title || 'Smart Absen', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.openWindow('./absen.html')
  );
});
