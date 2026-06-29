// Service worker for AI懶人報 Dashboard PWA — handles Web Push + notification taps.
// Registered from PushNotificationSettings.tsx with scope '/'.

self.addEventListener('push', function (event) {
  if (!event.data) return;
  let data = {};
  try {
    data = event.data.json();
  } catch {
    data = { title: 'AI懶人報', body: event.data.text() };
  }

  const title = data.title || 'AI懶人報';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [100, 50, 100],
    tag: data.tag || undefined,        // same tag collapses/replaces previous
    renotify: Boolean(data.tag),
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      // Focus an existing dashboard window and navigate it, if one is open.
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client && target.startsWith('/')) {
            return client.navigate(target).catch(() => {});
          }
          return;
        }
      }
      // Otherwise open a new window.
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});

// Activate immediately on update so the newest handler is used.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
