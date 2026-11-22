import { create } from "zustand";

import {
  CAPTCHA_INTERACTIVE_TIMEOUT_MS,
  CAPTCHA_TOKEN_TIMEOUT_MS,
  readTurnstileSiteKey,
} from "./config";

/**
 * One Turnstile token per protected auth call (Turnstile tokens are single
 * use and expire after five minutes, so nothing is cached or reused).
 *
 * `getCaptchaToken()` queues a request; `CaptchaHost` (mounted once in
 * app/_layout.tsx) draws a widget for the request at the head of the queue —
 * hidden on the page (web) or in a hidden WebView (iOS/Android) — and hands
 * the token back through `resolveCaptchaRequest`. Every way it can go wrong
 * (no host, offline, script blocked, error, timeout, "Not now") ends in
 * `null`, never a throw and never a wait longer than the timeout: the caller
 * then signs in without a token, which works while CAPTCHA is off in
 * Supabase and is refused once it is on — and a refused sign-in is what the
 * app already handles (felt reports, check-ins and feedback stay queued and
 * are sent later; the sign-in form shows its "No connection" line).
 */

export type CaptchaRequestMode = "hidden" | "visible";

export interface CaptchaRequest {
  id: number;
  siteKey: string;
  /** "hidden" first; "visible" once Turnstile asked for a tap, shown in the
   * "Quick check" sheet with a longer wait. */
  mode: CaptchaRequestMode;
}

interface PendingRequest {
  request: CaptchaRequest;
  resolve: (token: string | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface CaptchaStoreState {
  /** The request the host should draw now (head of the queue), or null. */
  active: CaptchaRequest | null;
}

export const useCaptchaStore = create<CaptchaStoreState>(() => ({ active: null }));

const queue: PendingRequest[] = [];
let nextRequestId = 1;

function publish(): void {
  const head = queue[0];
  useCaptchaStore.setState({ active: head ? { ...head.request } : null });
}

function settle(id: number, token: string | null): void {
  const index = queue.findIndex((entry) => entry.request.id === id);
  if (index < 0) {
    return; // already settled (timeout raced the widget) — nothing to do
  }
  const [entry] = queue.splice(index, 1);
  if (!entry) {
    return;
  }
  clearTimeout(entry.timer);
  publish();
  entry.resolve(token);
}

/** The browser says there is no connection (web): no point loading
 * Turnstile, the sign-in after it cannot reach Supabase either. iOS/Android
 * have no such flag here; the WebView fails fast offline instead. */
function isKnownOffline(): boolean {
  const nav = (globalThis as { navigator?: { onLine?: unknown } }).navigator;
  return nav?.onLine === false;
}

/**
 * A fresh Turnstile token for ONE auth call, or `null` (no site key, offline,
 * no token in time). Never throws.
 */
export function getCaptchaToken(): Promise<string | null> {
  const siteKey = readTurnstileSiteKey();
  if (!siteKey || isKnownOffline()) {
    return Promise.resolve(null);
  }
  return new Promise<string | null>((resolve) => {
    const id = nextRequestId++;
    queue.push({
      request: { id, siteKey, mode: "hidden" },
      resolve,
      timer: setTimeout(() => settle(id, null), CAPTCHA_TOKEN_TIMEOUT_MS),
    });
    publish();
  });
}

/** Host: the widget produced a token for request `id`. */
export function resolveCaptchaRequest(id: number, token: string): void {
  settle(id, token.length > 0 ? token : null);
}

/** Host: the widget failed (error, expired, script or page not loaded), or
 * the person chose "Not now". The caller goes ahead without a token. */
export function failCaptchaRequest(id: number): void {
  settle(id, null);
}

/** Host: Turnstile needs a tap for request `id`. It is drawn again in the
 * visible "Quick check" sheet, with time for the person to answer. */
export function showCaptchaRequest(id: number): void {
  const entry = queue.find((candidate) => candidate.request.id === id);
  if (!entry || entry.request.mode === "visible") {
    return;
  }
  clearTimeout(entry.timer);
  entry.request = { ...entry.request, mode: "visible" };
  entry.timer = setTimeout(() => settle(id, null), CAPTCHA_INTERACTIVE_TIMEOUT_MS);
  publish();
}

/** Test-only: forget every pending request (each resolves to null). */
export function __resetCaptchaForTests(): void {
  for (const entry of queue.splice(0, queue.length)) {
    clearTimeout(entry.timer);
    entry.resolve(null);
  }
  nextRequestId = 1;
  useCaptchaStore.setState({ active: null });
}
