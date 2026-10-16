const CACHE_NAME = "otg-academy-v34";
const FILES_TO_CACHE = [
  "/",
  "/index.html",
  "/manifest.json",
  "/otg-app-icon.svg",
  "/otg-app-icon-192.png",
  "/otg-app-icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(FILES_TO_CACHE))
      .catch(() => Promise.resolve())
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key.startsWith("otg-") && key !== CACHE_NAME)
        .map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Prevent any stale page or installed app from sending OTG students to Jitsi.
  // Return them to the academy if a Jitsi page navigation is attempted.
  if (request.mode === "navigate" && /(^|\.)jitsi\./i.test(url.hostname)) {
    event.respondWith(Response.redirect(new URL("/", self.location.origin).href, 302));
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Always fetch the latest app shell for page navigations so an installed
  // OTG Academy app cannot keep an old calling screen from its HTTP cache.
  const networkRequest = (request.mode === "navigate" || url.pathname === "/index.html")
    ? new Request(request, { cache: "no-store" })
    : request;

  event.respondWith(
    fetch(networkRequest).then(response => {
      if (response && response.ok && response.type === "basic") {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    }).catch(async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === "navigate") {
        const shell = await caches.match("/index.html");
        if (shell) return shell;
      }
      return new Response("You are offline. Reconnect to the internet and try again.", {
        status: 503,
        headers: {"Content-Type":"text/plain; charset=utf-8"}
      });
    })
  );
});
