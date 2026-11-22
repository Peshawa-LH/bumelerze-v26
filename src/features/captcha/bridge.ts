import { z } from "zod";

import {
  isPlausibleTurnstileSiteKey,
  TURNSTILE_PAGE_ORIGIN,
  TURNSTILE_PAGE_URL,
  type TurnstileLanguage,
} from "./config";

/**
 * The contract between the app (iOS/Android) and `public/turnstile.html`,
 * the page the hidden WebView opens. The page reads its settings from the
 * query string and answers with JSON messages through
 * `window.ReactNativeWebView.postMessage`. Keep both sides in step: the
 * page test (`__tests__/turnstile-page.test.ts`) reads the HTML file.
 */

export type TurnstileAppearance = "interaction-only" | "always";
export type TurnstileTheme = "light" | "dark";

export interface TurnstilePageOptions {
  siteKey: string;
  language: TurnstileLanguage;
  theme: TurnstileTheme;
  /** "interaction-only" while hidden (nothing drawn unless a tap is
   * needed); "always" inside the visible "Quick check" sheet. */
  appearance: TurnstileAppearance;
}

/** The page address with its settings, or `null` for a key that cannot
 * be one (config.ts already refuses those; never a crash here). */
export function buildTurnstilePageUrl(options: TurnstilePageOptions): string | null {
  if (!isPlausibleTurnstileSiteKey(options.siteKey)) {
    return null;
  }
  const query = [
    `sitekey=${encodeURIComponent(options.siteKey)}`,
    `lang=${options.language}`,
    `theme=${options.theme}`,
    `appearance=${options.appearance}`,
  ].join("&");
  return `${TURNSTILE_PAGE_URL}?${query}`;
}

const bridgeMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("token"), token: z.string().min(1).max(4096) }),
  z.object({ type: z.literal("error"), code: z.string().max(64).optional() }),
  z.object({ type: z.literal("expired") }),
  z.object({ type: z.literal("timeout") }),
  z.object({ type: z.literal("interactive") }),
]);

export type TurnstileBridgeMessage = z.infer<typeof bridgeMessageSchema>;

/** Parses one message from the page; anything else (or from another page)
 * is `null` and ignored. */
export function parseTurnstileBridgeMessage(
  data: string,
  fromUrl: string | undefined,
): TurnstileBridgeMessage | null {
  if (!isTurnstilePageUrl(fromUrl)) {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  const parsed = bridgeMessageSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Only our own page on our own origin may talk to the app. */
export function isTurnstilePageUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }
  return (
    url === TURNSTILE_PAGE_URL ||
    url.startsWith(`${TURNSTILE_PAGE_URL}?`) ||
    url.startsWith(`${TURNSTILE_PAGE_URL}.html`)
  );
}

/** Top-level navigations the WebView may make: the page (and the Pages
 * redirect from `.html`, should that ever be used); nothing else — a link
 * in the widget (Cloudflare's privacy notice) must not replace the page.
 * Frames inside it (Turnstile's own iframe) are always allowed. */
export function isAllowedTurnstileNavigation(url: string, isTopFrame: boolean): boolean {
  if (!isTopFrame) {
    return true;
  }
  return url.startsWith(`${TURNSTILE_PAGE_ORIGIN}/`) && isTurnstilePageUrl(url);
}
