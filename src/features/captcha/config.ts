/**
 * Cloudflare Turnstile CAPTCHA for Supabase Auth (security item A1.4).
 *
 * With "CAPTCHA protection" on in Supabase Auth, the server refuses an
 * anonymous sign-in, a password sign-in, a sign-up or a password recovery
 * that carries no Turnstile token. The app therefore sends a token on every
 * one of those calls (`./auth.ts`) as soon as a site key is configured here;
 * while CAPTCHA is still off the server ignores the token, so the app works
 * either way.
 *
 * The site key is public (it is shown to every visitor by design) and
 * reaches the bundle like the Supabase URL and key: an `EXPO_PUBLIC_`
 * variable inlined by Metro at build time — `scripts/build-app-web.sh` for
 * app.bumelerze.com, `eas.json` for the iOS/Android builds, `.env` for local
 * development. No key (empty or unset) means no CAPTCHA at all: every auth
 * call goes out exactly as it did before this feature.
 */

/** Explicit rendering: the script draws nothing until the app asks. Loaded
 * on demand only, never with the first page (`./turnstile-script.web.ts`). */
export const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** iOS/Android: Turnstile only runs on a real web page of an allowed
 * hostname, so the app opens this tiny page of the web app
 * (`public/turnstile.html`) in a hidden WebView. No ".html": Cloudflare
 * Pages answers `/turnstile.html` with a redirect to `/turnstile`, which
 * would cost a round trip on a weak connection. */
export const TURNSTILE_PAGE_ORIGIN = "https://app.bumelerze.com";
export const TURNSTILE_PAGE_URL = `${TURNSTILE_PAGE_ORIGIN}/turnstile`;

/** How long a sign-in waits for an invisible check before it goes ahead
 * without a token (it normally takes one to three seconds). */
export const CAPTCHA_TOKEN_TIMEOUT_MS = 15_000;
/** How long the "Quick check" sheet waits for a tap. */
export const CAPTCHA_INTERACTIVE_TIMEOUT_MS = 120_000;

/** Real keys look like "0x4AAAAAAA…"; anything else is a configuration
 * mistake and is treated as no key. */
const SITE_KEY_PATTERN = /^[0-9A-Za-z_-]{10,100}$/;

export function isPlausibleTurnstileSiteKey(value: string): boolean {
  return SITE_KEY_PATTERN.test(value);
}

/**
 * The configured Turnstile site key, or `null` (no CAPTCHA). Static member
 * access on `process.env` on purpose: Metro inlines exactly this shape (see
 * `src/lib/supabase.ts`); read on every call so tests can flip it.
 */
export function readTurnstileSiteKey(): string | null {
  const value = (process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY ?? "").trim();
  return value !== "" && isPlausibleTurnstileSiteKey(value) ? value : null;
}

export function isCaptchaConfigured(): boolean {
  return readTurnstileSiteKey() !== null;
}

/** Turnstile's own languages: Arabic and English as the app; Sorani and
 * Kurmanji are not offered, so the browser's language decides there. */
export type TurnstileLanguage = "ar" | "en" | "auto";

export function turnstileLanguageFor(appLanguage: string): TurnstileLanguage {
  if (appLanguage === "ar") {
    return "ar";
  }
  if (appLanguage === "en") {
    return "en";
  }
  return "auto";
}
