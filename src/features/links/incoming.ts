/**
 * Incoming links, resolved the way the web app resolves them.
 *
 * The iOS/Android app is opened by three kinds of address:
 * - **app.bumelerze.com** (universal links, once the Apple Team ID exists):
 *   the same paths the web app serves. Shared links and QR codes point here
 *   (src/config/urls.ts): `/e/<id>`, `/u/<username>`, `/home/join?code=…&key=…`.
 * - **bumelerze://…** (the app's own scheme, app.config.ts): the first part
 *   after `//` is the first path segment, so `bumelerze://e/<id>` is `/e/<id>`.
 * - **bumelerze.com** (the website): it only forwards a few old short links
 *   to the app (website-src/redirects.js). The app is not registered for
 *   bumelerze.com, so these arrive only if that ever changes; they are
 *   resolved with the same forwarding rules anyway.
 *
 * Every one of them becomes an app path, exactly where the web would end up:
 * `/e/<id>` goes straight to `/event/<id>` (on the web, app/e/[id].tsx
 * redirects there), the query travels along unchanged, the `#…` part is
 * dropped (no screen reads it).
 *
 * Pure string work with no URL object: React Native's `URL` is incomplete.
 */

/** Host of the web app (APP_ORIGIN in src/config/urls.ts). */
export const APP_LINK_HOST = "app.bumelerze.com";
/** Host of the website, which forwards the old short links. */
export const SITE_LINK_HOST = "bumelerze.com";
/** The app's own URL scheme (`scheme` in app.config.ts). */
export const APP_SCHEME = "bumelerze";
/** Where Google / Apple sign-in returns to in the iOS/Android app. Not a
 * screen: the sign-in session reads it (src/features/account/oauth-native.ts). */
export const AUTH_CALLBACK_PATH = "/auth/callback";
/** The full return address: add it to the Supabase redirect allow-list. */
export const NATIVE_AUTH_CALLBACK_URL = `${APP_SCHEME}://auth/callback`;

export type IncomingLink =
  /** Open this app path (starts with "/", may carry a query). */
  | { kind: "route"; path: string }
  /** Not a screen of the app (a static file, the sign-in return, a website
   * page): stay where the app is. */
  | { kind: "ignore" }
  /** Not ours to read (the development build's own links, Expo Go): leave
   * the address to Expo Router unchanged. */
  | { kind: "passthrough" };

const ABSOLUTE_URL = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(?:#.*)?$/i;
const RELATIVE_URL = /^([^?#]*)(\?[^#]*)?(?:#.*)?$/;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Files the web host serves next to the app, never screens. */
const STATIC_PREFIXES = ["/data/", "/_expo/", "/assets/", "/.well-known/"];

const IGNORE: IncomingLink = { kind: "ignore" };
const PASSTHROUGH: IncomingLink = { kind: "passthrough" };

function route(path: string): IncomingLink {
  return { kind: "route", path };
}

/** One leading slash, no doubled slashes, no trailing slash (except "/"). */
function normalizePathname(pathname: string): string {
  const collapsed = `/${pathname}`.replace(/\/{2,}/g, "/");
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, "") : collapsed;
}

/** A query that says something ("?" alone says nothing). */
function cleanQuery(query: string | undefined): string {
  return query && query.length > 1 ? query : "";
}

/**
 * A path on app.bumelerze.com (or the same path after `bumelerze://`), as
 * the web app resolves it.
 */
export function resolveAppPath(pathname: string, query?: string): IncomingLink {
  const path = normalizePathname(pathname);
  const search = cleanQuery(query);
  if (STATIC_PREFIXES.some((prefix) => `${path}/`.startsWith(prefix))) {
    return IGNORE;
  }
  // A file at the root (push-sw.js, manifest.webmanifest, robots.txt...).
  if (/^\/[^/]*\.[^/]*$/.test(path)) {
    return IGNORE;
  }
  if (path === AUTH_CALLBACK_PATH) {
    return IGNORE;
  }
  // The short event link, app/e/[id].tsx: straight on to the event page.
  const shortEvent = /^\/e\/([^/]+)$/.exec(path);
  if (shortEvent) {
    return route(`/event/${shortEvent[1]}${search}`);
  }
  return route(`${path}${search}`);
}

/** A path on bumelerze.com: the website's forwards (website-src/redirects.js);
 * anything else is a website page, not the app's. */
function resolveSitePath(pathname: string, query: string | undefined): IncomingLink {
  const path = normalizePathname(pathname);
  if (path === "/app" || path.startsWith("/app/")) {
    const inner = path.slice("/app".length);
    return resolveAppPath(inner === "/index.html" ? "/" : inner, query);
  }
  const shortEvent = /^\/e\/([^/]+)$/.exec(path);
  if (shortEvent) {
    return route(`/event/${shortEvent[1]}${cleanQuery(query)}`);
  }
  const profile = /^\/u\/([^/]+)$/.exec(path);
  if (profile) {
    return route(`/u/${profile[1]}${cleanQuery(query)}`);
  }
  if (path === "/join") {
    return route(`/home/join${cleanQuery(query)}`);
  }
  return IGNORE;
}

/**
 * Resolves any address the app is opened with. Never throws.
 *
 * @example
 * resolveIncomingLink("https://app.bumelerze.com/e/bml20170001")
 * // { kind: "route", path: "/event/bml20170001" }
 * resolveIncomingLink("bumelerze://home/join?code=AB&key=xy")
 * // { kind: "route", path: "/home/join?code=AB&key=xy" }
 */
export function resolveIncomingLink(url: string): IncomingLink {
  const input = url.trim();
  const absolute = ABSOLUTE_URL.exec(input);
  if (!absolute) {
    if (HAS_SCHEME.test(input)) {
      // "mailto:…", "bumelerze:e/1": nothing the app routes.
      return PASSTHROUGH;
    }
    const relative = RELATIVE_URL.exec(input);
    return relative ? resolveAppPath(relative[1] ?? "", relative[2]) : IGNORE;
  }
  const scheme = (absolute[1] ?? "").toLowerCase();
  const host = (absolute[2] ?? "").toLowerCase();
  const pathname = absolute[3] ?? "";
  const query = absolute[4];

  if (scheme === "http" || scheme === "https") {
    const bareHost = host.replace(/^www\./, "").replace(/:\d+$/, "");
    if (bareHost === APP_LINK_HOST) {
      return resolveAppPath(pathname, query);
    }
    if (bareHost === SITE_LINK_HOST) {
      return resolveSitePath(pathname, query);
    }
    // Expo's own QR links (Expo Router opens them at the start screen).
    if (bareHost === "exp.host" || bareHost === "u.expo.dev") {
      return PASSTHROUGH;
    }
    return IGNORE;
  }
  if (scheme === APP_SCHEME) {
    // The development build's launcher (expo-dev-client) and its own links.
    if (host === "expo-development-client") {
      return PASSTHROUGH;
    }
    // bumelerze://e/1 -> /e/1; bumelerze:///e/1 -> /e/1; bumelerze:// -> /
    return resolveAppPath(host ? `/${host}${pathname}` : pathname, query);
  }
  // exp://, exps:// (Expo Go), exp+bumelerze:// (development builds).
  return PASSTHROUGH;
}

/** True for the onboarding screens, where an arriving link has to wait. */
export function isOnboardingPath(path: string): boolean {
  const pathname = normalizePathname(path.split("?")[0] ?? "");
  return pathname === "/onboarding" || pathname.startsWith("/onboarding/");
}
