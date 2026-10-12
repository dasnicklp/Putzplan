// Service Worker: Offline-Cache für die App-Dateien.
// Netzwerk zuerst (damit Updates ankommen), Cache als Rückfall (damit es offline trotzdem startet).
// Die Verbindung zum Backend (andere Domain) wird nie zwischengespeichert.
// Außerdem: tägliche Erinnerungen (Push) anzeigen.
const CACHE = 'putzplan-v14';
const SHELL = ['./', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/version.json')) return; // Update-Prüfung immer direkt beim Server
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./')))
  );
});

/* Erinnerungen: Der Server schickt Titel, Text und die Zahl offener Aufgaben */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { /* leer */ }
  e.waitUntil((async () => {
    if (Number.isInteger(d.count) && self.navigator.setAppBadge) await self.navigator.setAppBadge(d.count).catch(() => {});
    await self.registration.showNotification(d.title || 'Haushalt', {
      body: d.body || 'Schau mal in die Haushalt-App.',
      tag: d.tag || 'putzplan', renotify: true,
      icon: './icon-192.png', badge: './icon-192.png',
      data: { url: './' },
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.length) return wins[0].focus();
    return self.clients.openWindow('./');
  })());
});
