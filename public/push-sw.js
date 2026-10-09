/*
 * Bumelerze web push service worker (earthquake alerts, migration 0062).
 *
 * Exported as-is from public/ to the root of the web build, so it is served
 * next to the app (bumelerze.com/app/push-sw.js) and its scope is the app
 * (/app/). It is registered only when a person turns on alerts on this
 * device. It has NO fetch handler: it never touches page loads or caching.
 *
 * push              shows the notification. The text is already localized by
 *                   the send-alerts edge function; the payload is
 *                   { title, body, tag, path, quiet, renotify, lang, dir, ts }.
 * notificationclick opens the app at the path (an event page), inside this
 *                   scope only.
 */
"use strict";

var DEFAULT_TITLE = "Bumelerze";

function scopeBase() {
  return self.registration && self.registration.scope
    ? self.registration.scope
    : self.location.origin + "/";
}

/* Only simple in-app paths ("event/bml2026abcd"); anything else opens the app home. */
function targetUrl(path) {
  var base = scopeBase();
  if (typeof path !== "string" || !/^[A-Za-z0-9_-][A-Za-z0-9/_-]*$/.test(path) || path.indexOf("//") !== -1) {
    return base;
  }
  return base + path;
}

function readPayload(event) {
  if (!event.data) {
    return {};
  }
  try {
    var parsed = event.data.json();
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    try {
      return { body: event.data.text() };
    } catch (error2) {
      return {};
    }
  }
}

function notificationFor(data) {
  var base = scopeBase();
  var options = {
    body: typeof data.body === "string" ? data.body : "",
    tag: typeof data.tag === "string" && data.tag ? data.tag : "bumelerze",
    renotify: data.renotify === true,
    silent: data.quiet === true,
    icon: base + "push-icon-192.png",
    badge: base + "push-badge.png",
    dir: data.dir === "rtl" || data.dir === "ltr" ? data.dir : "auto",
    timestamp: typeof data.ts === "number" ? data.ts : Date.now(),
    data: { url: targetUrl(data.path) },
  };
  if (typeof data.lang === "string") {
    options.lang = data.lang;
  }
  var title = typeof data.title === "string" && data.title ? data.title : DEFAULT_TITLE;
  return { title: title, options: options };
}

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", function (event) {
  var shown = notificationFor(readPayload(event));
  event.waitUntil(self.registration.showNotification(shown.title, shown.options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var base = scopeBase();
  var url = event.notification.data && event.notification.data.url;
  if (typeof url !== "string" || url.indexOf(base) !== 0) {
    url = base;
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var client = list[i];
        if (client.url.indexOf(base) === 0 && "navigate" in client && "focus" in client) {
          return client
            .navigate(url)
            .then(function (navigated) {
              return (navigated || client).focus();
            })
            .catch(function () {
              return self.clients.openWindow(url);
            });
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
