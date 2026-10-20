const CACHE_NAME = "otg-academy-v49";
const FILES_TO_CACHE = [
  "/",
  "/index.html",
  "/guest-call.html",
  "/manifest.json",
  "/otg-app-icon.svg",
  "/otg-app-icon-192.png",
  "/otg-app-icon-512.png"
];

self.addEventListener("message", event => {
  if (event.data && event.data.type === "OTG_SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("install", event => {
  // Activate new notification routing without requiring the user to sign in
  // and press the Student Hub update button first.
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(FILES_TO_CACHE))
      .catch(() => Promise.resolve())
      .then(() => self.skipWaiting())
  );
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

// Show genuine OS-level notifications delivered by the Web Push service.
self.addEventListener("push", event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = { body: event.data ? event.data.text() : "" };
  }

  const isTest = payload.type === "test";
  const isAssessmentResult = payload.type === "assessment-result";
  const callId = typeof payload.callId === "string" ? payload.callId : "";
  const callerName = typeof payload.callerName === "string" && payload.callerName.trim()
    ? payload.callerName.trim()
    : "An OTG student";
  const callType = payload.callType === "video" ? "video" : "voice";
  const title = isAssessmentResult ? (payload.title || "OTG assessment results released") : (isTest ? "OTG call alerts are working" : (callType === "video" ? "Incoming OTG video call" : "Incoming OTG voice call"));
  const options = {
    body: payload.body || (isAssessmentResult ? "Your Coach has released your assessment results. Open Assessment Results to view them." : (isTest ? "This device can receive background notifications from OTG GRAPHIC Academy." : callerName + " is calling you.")),
    icon: "/otg-app-icon-192.png",
    badge: "/otg-app-icon-192.png",
    tag: isAssessmentResult ? "otg-assessment-result" : (callId ? "otg-call-" + callId : "otg-incoming-call"),
    renotify: true,
    requireInteraction: true,
    data: {
      type: isAssessmentResult ? "assessment-result" : (isTest ? "test" : "call"),
      callId,
      callerName,
      callType,
      url: typeof payload.url === "string" ? payload.url : (isAssessmentResult ? "/?otgAssessmentResults=1" : "/?otgIncomingCall=" + encodeURIComponent(callId) + "&otgCallType=" + encodeURIComponent(callType))
    },
    actions: (isTest || isAssessmentResult) ? [{ action: "dismiss", title: "Dismiss" }] : [
      { action: "open-call", title: "Open call" },
      { action: "dismiss", title: "Dismiss" }
    ]
  };

  // Keep push handling observable: if the OS rejects the notification,
  // record the failure and notify any open OTG page for diagnostics.
  event.waitUntil(
    self.registration.showNotification(title, options).catch(async error => {
      console.error("OTG_PUSH_SHOW_NOTIFICATION_FAILED", String(error && error.message || error));
      try {
        const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const client of clients) {
          client.postMessage({
            type: "OTG_PUSH_DISPLAY_FAILED",
            message: String(error && error.message || "The operating system rejected the notification.")
          });
        }
      } catch (_) {}
    })
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  if (event.action === "dismiss") return;

  const data = event.notification.data || {};
  const targetUrl = new URL(
    typeof data.url === "string" ? data.url : "/",
    self.location.origin
  );
  if (targetUrl.origin !== self.location.origin) targetUrl.href = self.location.origin + "/";

  event.waitUntil((async () => {
    // Guest invitations must open as a standalone public call page. Do not
    // route them through an existing Student Hub window, where auth state or
    // app navigation can interfere with joining while signed out.
    if (data.type === "call" && targetUrl.pathname === "/guest-call.html") {
      await self.clients.openWindow(targetUrl.href);
      return;
    }
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        if (data.type === "assessment-result") {
          client.postMessage({ type: "OTG_ASSESSMENT_RESULT_NOTIFICATION_CLICK" });
        } else if (data.type !== "test") {
          client.postMessage({
            type: "OTG_INCOMING_CALL_NOTIFICATION_CLICK",
            callId: typeof data.callId === "string" ? data.callId : "",
            callerName: typeof data.callerName === "string" ? data.callerName : "OTG Student",
            callType: data.callType === "video" ? "video" : "voice"
          });
        }
        if ("navigate" in client) {
          await client.navigate(targetUrl.href);
        }
        return;
      }
    }
    await self.clients.openWindow(targetUrl.href);
  })());
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
