// Self-destructing service worker.
// Earlier versions cached the app shell, which left some devices stuck on an old
// build. This version removes ALL caches, stops controlling pages, and reloads any
// open tab — so from now on everyone always loads the latest version from the network.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: "window" });
    for (const client of clients) {
      try { client.navigate(client.url); } catch (e) { /* ignore */ }
    }
    await self.registration.unregister();
  })());
});

// No fetch handler — every request goes straight to the network.
