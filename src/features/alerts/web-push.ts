import type { WebPushKeys } from "./types";

/**
 * Browser side of web push (migration 0062). The service worker is
 * `public/push-sw.js`, exported next to the app (app.bumelerze.com/push-sw.js,
 * scope "/") so its scope is the whole app. Everything here takes the
 * browser objects as an argument so tests can hand in fakes.
 */

/** Static access so Metro inlines it (same reason as lib/supabase.ts). */
export function readVapidPublicKey(): string | null {
  const value = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY;
  return value && value.trim().length > 0 ? value.trim() : null;
}

/** The app's base path: "" at app.bumelerze.com and in local dev; set only
 * when a build is served under a subpath (app.config.ts experiments.baseUrl,
 * e.g. the dormant Netlify mirror's "/app"). */
export function webBase(): string {
  return process.env.EXPO_BASE_URL ?? "";
}

export const SERVICE_WORKER_FILE = "push-sw.js";

export type WebPushSupport =
  | "supported"
  | "unsupported"
  | "ios-home-screen"
  | "not-configured"
  | "native";

/** The parts of `window`/`navigator` this module reads. */
export interface BrowserEnv {
  navigator: {
    userAgent?: string;
    platform?: string;
    maxTouchPoints?: number;
    standalone?: boolean;
    serviceWorker?: {
      register(url: string, options: { scope: string }): Promise<ServiceWorkerRegistrationLike>;
      getRegistration(scope?: string): Promise<ServiceWorkerRegistrationLike | undefined>;
      ready: Promise<ServiceWorkerRegistrationLike>;
    };
  };
  window: {
    PushManager?: unknown;
    Notification?: {
      permission: "default" | "granted" | "denied";
      requestPermission(): Promise<"default" | "granted" | "denied">;
    };
    matchMedia?: (query: string) => { matches: boolean };
  };
  document?: {
    head: { appendChild(node: unknown): unknown };
    querySelector(selector: string): unknown;
    createElement(tag: string): HeadNodeLike;
  };
}

/** The parts of a `<link>`/`<meta>` element the manifest helpers touch. */
export interface HeadNodeLike {
  setAttribute(name: string, value: string): void;
  getAttribute?(name: string): string | null;
  remove?(): void;
}

export interface PushSubscriptionLike {
  endpoint: string;
  options?: { applicationServerKey?: ArrayBuffer | null };
  toJSON(): { endpoint?: string; keys?: Record<string, string> };
  unsubscribe(): Promise<boolean>;
}

export interface ServiceWorkerRegistrationLike {
  pushManager: {
    getSubscription(): Promise<PushSubscriptionLike | null>;
    subscribe(options: {
      userVisibleOnly: boolean;
      applicationServerKey: Uint8Array;
    }): Promise<PushSubscriptionLike>;
  };
}

export function browserEnv(): BrowserEnv | null {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return null;
  }
  return {
    navigator: navigator as unknown as BrowserEnv["navigator"],
    window: window as unknown as BrowserEnv["window"],
    ...(typeof document === "undefined"
      ? {}
      : { document: document as unknown as NonNullable<BrowserEnv["document"]> }),
  };
}

/** iPhone, iPod, or an iPad that reports itself as a Mac. */
export function isIosDevice(nav: BrowserEnv["navigator"]): boolean {
  const ua = nav.userAgent ?? "";
  if (/iPad|iPhone|iPod/.test(ua)) {
    return true;
  }
  return nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1;
}

/** Opened from the Home Screen (iOS needs this for web push). */
export function isStandalone(env: BrowserEnv): boolean {
  if (env.navigator.standalone === true) {
    return true;
  }
  try {
    return env.window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  } catch {
    return false;
  }
}

export function detectSupport(
  platformOS: string,
  vapidPublicKey: string | null,
  env: BrowserEnv | null,
): WebPushSupport {
  if (platformOS !== "web") {
    return "native";
  }
  if (!vapidPublicKey) {
    return "not-configured";
  }
  if (!env) {
    return "unsupported";
  }
  if (isIosDevice(env.navigator) && !isStandalone(env)) {
    return "ios-home-screen";
  }
  if (!env.navigator.serviceWorker || !env.window.PushManager || !env.window.Notification) {
    return "unsupported";
  }
  return "supported";
}

export function urlBase64ToUint8Array(value: string): Uint8Array {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const raw = globalThis.atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) {
    return true; // the browser does not tell; assume it is ours
  }
  const view = new Uint8Array(a);
  return view.length === b.length && view.every((byte, i) => byte === b[i]);
}

export function keysOf(subscription: PushSubscriptionLike): WebPushKeys {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!p256dh || !auth) {
    throw new Error("push subscription without keys");
  }
  return { endpoint: json.endpoint ?? subscription.endpoint, p256dh, auth };
}

function scopeOf(base: string): string {
  return `${base}/`;
}

/** The current subscription of this browser, if any (never prompts). */
export async function existingSubscription(
  env: BrowserEnv,
  base: string,
): Promise<PushSubscriptionLike | null> {
  const registration = await env.navigator.serviceWorker?.getRegistration(scopeOf(base));
  if (!registration) {
    return null;
  }
  return registration.pushManager.getSubscription();
}

/**
 * Registers the worker and subscribes. Permission must already be granted
 * (ask with `requestPermission` straight from the tap: Safari only allows it
 * inside the user's gesture). A subscription made with another server key
 * (the key was rotated) is replaced.
 */
export async function subscribeBrowser(
  env: BrowserEnv,
  base: string,
  vapidPublicKey: string,
): Promise<WebPushKeys> {
  const sw = env.navigator.serviceWorker;
  if (!sw) {
    throw new Error("service workers are not supported");
  }
  await sw.register(`${base}/${SERVICE_WORKER_FILE}`, { scope: scopeOf(base) });
  const registration = await sw.ready;
  const key = urlBase64ToUint8Array(vapidPublicKey);
  const current = await registration.pushManager.getSubscription();
  if (current && sameKey(current.options?.applicationServerKey, key)) {
    return keysOf(current);
  }
  if (current) {
    await current.unsubscribe();
  }
  const created = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
  return keysOf(created);
}

/** Unsubscribes this browser; returns the endpoint it had, for the server. */
export async function unsubscribeBrowser(env: BrowserEnv, base: string): Promise<string | null> {
  const current = await existingSubscription(env, base);
  if (!current) {
    return null;
  }
  const endpoint = current.endpoint;
  await current.unsubscribe();
  return endpoint;
}

/**
 * iOS installs a site as a Home Screen app (the only way it gets web push)
 * from the page's manifest. Added only while the tester screen is open, so
 * the public app's Add to Home Screen behaves exactly as before.
 *
 * Safari takes the browser bars' colour from a manifest `theme_color`, even
 * over a `<meta name="theme-color">` added later, so the manifest has NO
 * theme_color and no red at all (review note 11.2: the bars stayed red on
 * this screen while the manifest said Signal Red). A theme-color meta with
 * the app's own background colour is still set alongside the manifest, and
 * the returned cleanup removes everything this call added and puts back any
 * theme-color that was there before. Call it on unmount: nothing may
 * stay changed after the screen closes (review note 11.2, 2026-10-13).
 */
export function ensureWebAppManifest(
  env: BrowserEnv,
  base: string,
  themeColor?: string,
): () => void {
  const doc = env.document;
  if (!doc) {
    return () => {};
  }
  const added: HeadNodeLike[] = [];
  const add = (tag: string, attrs: Record<string, string>, selector: string) => {
    if (doc.querySelector(selector)) {
      return;
    }
    const node = doc.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) {
      node.setAttribute(name, value);
    }
    doc.head.appendChild(node);
    added.push(node);
  };
  add("link", { rel: "manifest", href: `${base}/manifest.webmanifest` }, 'link[rel="manifest"]');
  add("link", { rel: "apple-touch-icon", href: `${base}/push-icon-192.png` }, 'link[rel="apple-touch-icon"]');
  add(
    "meta",
    { name: "apple-mobile-web-app-capable", content: "yes" },
    'meta[name="apple-mobile-web-app-capable"]',
  );

  let restoreThemeColor: (() => void) | null = null;
  if (themeColor) {
    const existing = doc.querySelector('meta[name="theme-color"]') as HeadNodeLike | null;
    if (existing) {
      const previous = existing.getAttribute?.("content") ?? null;
      existing.setAttribute("content", themeColor);
      restoreThemeColor = () => {
        if (previous !== null) {
          existing.setAttribute("content", previous);
        }
      };
    } else {
      add("meta", { name: "theme-color", content: themeColor }, 'meta[name="theme-color"]');
    }
  }

  return () => {
    for (const node of added) {
      node.remove?.();
    }
    added.length = 0;
    restoreThemeColor?.();
    restoreThemeColor = null;
  };
}
