self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    payload = {
      title: 'PaintFlow notification',
      body: event.data?.text() || 'Open PaintFlow to review new customer activity.',
    };
  }

  const title = payload.title || 'PaintFlow notification';
  const options = {
    body: payload.body || payload.message || 'Open PaintFlow to review new customer activity.',
    tag: payload.tag || 'paintflow-notification',
    data: { url: payload.url || payload.href || '/notifications' },
    icon: '/icon-192.png',
    badge: '/icon-192.png',
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/notifications';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client) await client.navigate(url);
        return;
      }
    }
    if (self.clients.openWindow) {
      await self.clients.openWindow(url);
    }
  })());
});
