/**
 * Service Worker — Shaadi Book Push Notifications
 *
 * Handles incoming push events and notification clicks.
 * Registered from the NotificationProvider component.
 */

/* eslint-disable no-restricted-globals */

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Shaadi Book", body: event.data.text() };
  }

  const { title, body, url, tag } = payload;

  const options = {
    body: body || "",
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    tag: tag || "shaadi-book",
    data: { url: url || "/" },
    vibrate: [100, 50, 100],
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title || "Shaadi Book", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url || "/";

  event.waitUntil(
    // Try to focus an existing tab, otherwise open a new one
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes("parshandspoorthi.com") && "focus" in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        return self.clients.openWindow(url);
      })
  );
});
