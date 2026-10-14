/*
 * Bumelerze service worker: web push alerts (migration 0062) AND the offline
 * copy of the app (2026-10, "open without signal").
 *
 * One file on purpose. A browser allows one service worker per scope and the
 * app lives at the root, so a second worker registered at "/" would replace
 * this one (and with it the alert subscription). The file keeps its old name,
 * push-sw.js, so the registration every alert subscriber already has simply
 * updates in place: same URL, same scope, same subscription.
 *
 * Exported as-is from public/ to the root of the web build, so it is served
 * next to the app (app.bumelerze.com/push-sw.js) and its scope is the app
 * (/). Under a subpath build its scope would be that subpath instead: every
 * URL below is built from the registration scope, never hard-coded. The app
 * registers it on every web visit (src/lib/offline-shell.web.ts); alerts
 * still subscribe only when a person turns them on.
 *
 * push              shows the notification. The text is already localized by
 *                   the send-alerts edge function; the payload is
 *                   { title, body, tag, path, quiet, renotify, lang, dir, ts }.
 * notificationclick opens the app at the path (an event page), inside this
 *                   scope only.
 *
 * Offline copy (rules from the 2026-08 stale-page incident, D86):
 * - one cache per deploy, "bumelerze-app-<BUILD_ID>"; scripts/build-app-web.sh
 *   stamps BUILD_ID, so every deploy is a new worker with a new cache;
 * - page loads are NETWORK FIRST: the cached page is used only when the
 *   network cannot be reached at all, and only a page of this worker's own
 *   deploy is ever kept (checked by its <meta name="bumelerze-build">);
 * - CACHE FIRST only for the content-hashed files under _expo/static/ and
 *   assets/ (their name changes whenever their content does), and only a
 *   real script/style/font answer is kept, never the HTML page a host sends
 *   for a file it does not have; the 24 MB catalogue database is never kept;
 * - nothing from other sites (Supabase, USGS, EMSC, map tiles) and no POST
 *   ever goes through the cache: those requests are not touched at all;
 * - the previous deploy's cache is kept until this deploy's copy is complete
 *   (a page of this deploy has loaded and said which files it used), then
 *   deleted;
 * - emergency switch: building with BUMELERZE_OFFLINE_SW=off stamps
 *   OFFLINE_MODE "off"; the worker then deletes its caches and stops
 *   answering page loads, and alerts keep working. A source copy that was
 *   not stamped (BUILD_ID "dev", local development) caches nothing.
 */
"use strict";

var DEFAULT_TITLE = "Bumelerze";

/* Stamped by scripts/build-app-web.sh. Keep each on one line, exactly. */
var BUILD_ID = "dev";
var OFFLINE_MODE = "on";

var CACHE_PREFIX = "bumelerze-app-";
var CACHE_NAME = CACHE_PREFIX + BUILD_ID;
/* Cache keys inside the scope that are not real files. */
var SHELL_KEY = "__offline-shell";
var COMPLETE_KEY = "__offline-complete";
/* Nothing bigger is kept (a compressed size when the host compresses). */
var MAX_ENTRY_BYTES = 5 * 1024 * 1024;

function noop() {}

function offlineEnabled() {
  return OFFLINE_MODE === "on" && BUILD_ID !== "dev" && typeof caches !== "undefined";
}

function scopeBase() {
  return self.registration && self.registration.scope
    ? self.registration.scope
    : self.location.origin + "/";
}

/* Only simple in-app paths ("event/bml2026abcd"); anything else opens the app home. */
function targetUrl(path) {
  var base = scopeBase();
  if (
    typeof path !== "string" ||
    !/^[A-Za-z0-9_-][A-Za-z0-9/_-]*$/.test(path) ||
    path.indexOf("//") !== -1
  ) {
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

/* ---------------------------------------------------------------------- */
/* Offline copy                                                            */
/* ---------------------------------------------------------------------- */

function scopePath() {
  return new URL(scopeBase()).pathname;
}

function keyRequest(name) {
  return new Request(scopeBase() + name);
}

function isHtml(response) {
  return (
    (response.headers.get("content-type") || "").toLowerCase().indexOf("text/html") !== -1
  );
}

/* The deploy a page belongs to (scripts/build-app-web.sh adds the meta tag). */
function pageBuild(html) {
  var match = /<meta name="bumelerze-build" content="([^"]*)"/.exec(html);
  return match ? match[1] : null;
}

/* Content-hashed files of this app: _expo/static/... and assets/... */
function isHashedAsset(url) {
  if (url.origin !== self.location.origin) {
    return false;
  }
  var base = scopePath();
  if (url.pathname.indexOf(base) !== 0) {
    return false;
  }
  var rest = url.pathname.slice(base.length);
  if (rest.indexOf("_expo/static/") !== 0 && rest.indexOf("assets/") !== 0) {
    return false;
  }
  return !/\.sqlite$/i.test(rest);
}

/* Worth keeping: a complete, real answer of the right kind. */
function isKeepable(url, response) {
  if (
    !response ||
    !response.ok ||
    response.status !== 200 ||
    response.type === "opaque"
  ) {
    return false;
  }
  var type = (response.headers.get("content-type") || "").toLowerCase();
  if (type.indexOf("text/html") !== -1) {
    return false;
  }
  if (/\.m?js$/i.test(url.pathname) && type.indexOf("javascript") === -1) {
    return false;
  }
  if (/\.css$/i.test(url.pathname) && type.indexOf("css") === -1) {
    return false;
  }
  var length = Number(response.headers.get("content-length") || 0);
  return !(length > MAX_ENTRY_BYTES);
}

function keep(url, response) {
  return caches.open(CACHE_NAME).then(function (cache) {
    return cache.put(url, response);
  });
}

var MATCH = { ignoreVary: true };

function fetchAndKeep(href) {
  var url = new URL(href, scopeBase());
  if (!isHashedAsset(url)) {
    return Promise.resolve();
  }
  var key = url.toString();
  return caches
    .open(CACHE_NAME)
    .then(function (cache) {
      return cache.match(key, MATCH).then(function (own) {
        if (own) {
          return undefined; // already kept for this deploy
        }
        // Same name means same content: reuse an older deploy's copy.
        return caches.match(key, MATCH).then(function (older) {
          if (older) {
            return cache.put(key, older);
          }
          return fetch(key, { credentials: "same-origin" }).then(function (response) {
            if (isKeepable(url, response)) {
              return cache.put(key, response);
            }
          });
        });
      });
    })
    .catch(noop);
}

/* The app page of this deploy, and the files it names, into this cache. */
function keepShell(response) {
  return response.text().then(function (html) {
    if (pageBuild(html) !== BUILD_ID) {
      return false;
    }
    var hrefs = [];
    var pattern = /(?:src|href)="([^"]+)"/g;
    var match;
    while ((match = pattern.exec(html))) {
      hrefs.push(match[1]);
    }
    return Promise.all(hrefs.map(fetchAndKeep))
      .then(function () {
        return keep(
          keyRequest(SHELL_KEY),
          new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }),
        );
      })
      .then(function () {
        return true;
      });
  });
}

function precacheShell() {
  return fetch(scopeBase(), { cache: "no-store", credentials: "same-origin" })
    .then(function (response) {
      return response.ok && isHtml(response) ? keepShell(response) : false;
    })
    .catch(function () {
      return false;
    });
}

/* "Complete": this deploy's page has loaded and its files are kept. */
function markComplete() {
  return caches.open(CACHE_NAME).then(function (cache) {
    return cache.match(keyRequest(SHELL_KEY)).then(function (shell) {
      if (!shell) {
        return false;
      }
      return cache
        .put(keyRequest(COMPLETE_KEY), new Response(String(Date.now())))
        .then(function () {
          return true;
        });
    });
  });
}

function completedAt(name) {
  return caches
    .open(name)
    .then(function (cache) {
      return cache.match(keyRequest(COMPLETE_KEY));
    })
    .then(function (marker) {
      return marker ? marker.text().then(Number) : 0;
    })
    .catch(function () {
      return 0;
    });
}

/* Our caches, newest complete first; this deploy's own cache always first
 * once complete. */
function rankedCaches() {
  return caches.keys().then(function (names) {
    var ours = names.filter(function (name) {
      return name.indexOf(CACHE_PREFIX) === 0;
    });
    return Promise.all(ours.map(completedAt)).then(function (times) {
      return ours
        .map(function (name, i) {
          return { name: name, completed: times[i] };
        })
        .sort(function (a, b) {
          if (a.name === CACHE_NAME && a.completed) return -1;
          if (b.name === CACHE_NAME && b.completed) return 1;
          return b.completed - a.completed;
        });
    });
  });
}

/* Keep this deploy's cache, plus the newest complete older one until this
 * one is complete. With the offline copy switched off: delete them all. */
function cleanUp() {
  return rankedCaches().then(function (ranked) {
    var keepNames = {};
    if (offlineEnabled()) {
      keepNames[CACHE_NAME] = true;
      var own = ranked.filter(function (c) {
        return c.name === CACHE_NAME;
      })[0];
      if (!own || !own.completed) {
        var older = ranked.filter(function (c) {
          return c.name !== CACHE_NAME && c.completed;
        })[0];
        if (older) {
          keepNames[older.name] = true;
        }
      }
    }
    return Promise.all(
      ranked
        .filter(function (c) {
          return !keepNames[c.name];
        })
        .map(function (c) {
          return caches.delete(c.name);
        }),
    );
  });
}

function offlineShell() {
  return rankedCaches().then(function (ranked) {
    var tryNext = function (i) {
      if (i >= ranked.length) {
        return undefined;
      }
      return caches
        .open(ranked[i].name)
        .then(function (cache) {
          return cache.match(keyRequest(SHELL_KEY));
        })
        .then(function (shell) {
          return shell || tryNext(i + 1);
        });
    };
    return tryNext(0);
  });
}

function pageResponse(event) {
  return fetch(event.request).then(
    function (response) {
      if (response.ok && isHtml(response)) {
        // A fresh copy of this deploy's page becomes the offline page.
        event.waitUntil(keepShell(response.clone()).catch(noop));
      }
      return response;
    },
    function (error) {
      // Only when the network cannot be reached at all.
      return offlineShell().then(function (shell) {
        if (shell) {
          return shell;
        }
        throw error;
      });
    },
  );
}

function assetResponse(event, url) {
  return caches.match(event.request, MATCH).then(function (hit) {
    if (hit) {
      return hit;
    }
    return fetch(event.request).then(function (response) {
      if (isKeepable(url, response)) {
        event.waitUntil(keep(event.request, response.clone()).catch(noop));
      }
      return response;
    });
  });
}

self.addEventListener("install", function (event) {
  self.skipWaiting();
  if (offlineEnabled()) {
    event.waitUntil(precacheShell());
  }
});

self.addEventListener("activate", function (event) {
  var tidy = typeof caches === "undefined" ? Promise.resolve() : cleanUp().catch(noop);
  event.waitUntil(
    tidy.then(function () {
      return self.clients.claim();
    }),
  );
});

self.addEventListener("fetch", function (event) {
  if (!offlineEnabled()) {
    return;
  }
  var request = event.request;
  if (request.method !== "GET") {
    return;
  }
  var url = new URL(request.url);
  if (request.mode === "navigate") {
    if (url.origin === self.location.origin && url.pathname.indexOf(scopePath()) === 0) {
      event.respondWith(pageResponse(event));
    }
    return;
  }
  if (isHashedAsset(url)) {
    event.respondWith(assetResponse(event, url));
  }
});

/* From the page (src/lib/offline-shell.web.ts):
 * - { type: "bumelerze-version" }: answers which deploy this worker is;
 * - { type: "bumelerze-keep", build, urls }: the files a page of this deploy
 *   loaded before the worker was in control (the first visit); kept, then
 *   this deploy's copy is complete and older caches are deleted. */
self.addEventListener("message", function (event) {
  var data = event.data || {};
  var reply = event.ports && event.ports[0];
  if (data.type === "bumelerze-version") {
    if (reply) {
      reply.postMessage({ build: BUILD_ID, offline: offlineEnabled() });
    }
    return;
  }
  if (data.type !== "bumelerze-keep" || !offlineEnabled() || data.build !== BUILD_ID) {
    return;
  }
  var urls = Array.isArray(data.urls) ? data.urls.slice(0, 200) : [];
  event.waitUntil(
    Promise.all(urls.map(fetchAndKeep))
      .then(function () {
        return caches.open(CACHE_NAME);
      })
      .then(function (cache) {
        return cache.match(keyRequest(SHELL_KEY));
      })
      .then(function (shell) {
        return shell ? true : precacheShell();
      })
      .then(markComplete)
      .then(cleanUp)
      .catch(noop),
  );
});

/* ---------------------------------------------------------------------- */
/* Push alerts                                                             */
/* ---------------------------------------------------------------------- */

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
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (list) {
        for (var i = 0; i < list.length; i++) {
          var client = list[i];
          if (
            client.url.indexOf(base) === 0 &&
            "navigate" in client &&
            "focus" in client
          ) {
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
