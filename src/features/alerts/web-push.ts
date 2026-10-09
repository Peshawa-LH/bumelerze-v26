import type { WebPushKeys } from "./types";

/**
 * Browser side of web push (migration 0062). The service worker is
 * `public/push-sw.js`, exported next to the app (bumelerze.com/app/push-sw.js)
 * so its scope is the app. Everything here takes the browser objects as an
 * argument so tests can hand in fakes.
 */

/** Static access so Metro inlines it (same reason as lib/supabase.ts). */
export function readVapidPublicKey(): string | null {
  const value = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY;
  return value && value.trim().length > 0 ? value.trim() : null;
}

/** "/app" on bumelerze.com, "" in local dev (app.config.ts experiments.baseUrl). */
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
    createElement(tag: string): { setAttribute(name: string, value: string): void };
  };
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
 * from the page's manifest. Added only on the tester screen, so the public
 * app's Add to Home Screen behaves exactly as before.
 */
export function ensureWebAppManifest(env: BrowserEnv, base: string): void {
  const doc = env.document;
  if (!doc) {
    return;
  }
  const add = (tag: string, attrs: Record<string, string>, selector: string) => {
    if (doc.querySelector(selector)) {
      return;
    }
    const node = doc.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) {
      node.setAttribute(name, value);
    }
    doc.head.appendChild(node);
  };
  add("link", { rel: "manifest", href: `${base}/manifest.webmanifest` }, 'link[rel="manifest"]');
  add("link", { rel: "apple-touch-icon", href: `${base}/push-icon-192.png` }, 'link[rel="apple-touch-icon"]');
  add(
    "meta",
    { name: "apple-mobile-web-app-capable", content: "yes" },
    'meta[name="apple-mobile-web-app-capable"]',
  );
}
