const CACHE_NAME = "prixradar-shell-v6";
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  ) {
    return;
  }

  if (request.mode === "navigate") {
    const cacheableNavigation = url.pathname === "/" || url.pathname === "/transparence";
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && cacheableNavigation) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("/")).then((cached) => cached || Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response.ok || response.type !== "basic") return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      });
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  const requestedUrl =
    event.notification.data && typeof event.notification.data.url === "string"
      ? event.notification.data.url
      : "/";
  let targetUrl = "/";
  try {
    const parsed = new URL(requestedUrl, self.location.origin);
    if (parsed.origin === self.location.origin) targetUrl = `${parsed.pathname}${parsed.search}`;
  } catch {
    targetUrl = "/";
  }

  event.notification.close();
  event.waitUntil(
    Promise.resolve("clearAppBadge" in self.navigator ? self.navigator.clearAppBadge() : undefined).then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true })).then((clients) => {
      const existing = clients.find((client) => client.url.startsWith(self.location.origin));
      if (existing) {
        return existing.navigate(targetUrl).then(() => existing.focus());
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }

  const title =
    typeof payload.title === "string" && payload.title.trim()
      ? payload.title.slice(0, 120)
      : "PrixRadar · anomalie confirmée";
  const body =
    typeof payload.body === "string" && payload.body.trim()
      ? payload.body.slice(0, 300)
      : "Un signal vérifié correspond à vos critères.";
  const alertId =
    typeof payload.alertId === "string" ? payload.alertId.slice(0, 160) : "nouveau";
  const url =
    typeof payload.url === "string" && payload.url.startsWith("/")
      ? payload.url
      : "/";
  const tier = payload.tier === "urgent" ? "urgent" : payload.tier === "digest" ? "digest" : "personal";
  const badgeCount = Number.isSafeInteger(payload.badgeCount) && payload.badgeCount > 0 ? payload.badgeCount : 1;

  event.waitUntil(
    Promise.resolve("setAppBadge" in self.navigator ? self.navigator.setAppBadge(badgeCount) : undefined).then(() => self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: `prixradar-${tier}-${alertId}`,
      renotify: tier === "urgent",
      data: { url, tier },
    })),
  );
});
