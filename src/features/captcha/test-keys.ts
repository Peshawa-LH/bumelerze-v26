/**
 * Cloudflare's documented Turnstile TESTING site keys (developers.cloudflare.com,
 * Turnstile "Testing"), for tests and local tries only — never imported by
 * app code, so they never ship in a build. They work on any hostname,
 * including localhost, and produce the dummy token `XXXX.DUMMY.TOKEN.XXXX`,
 * which only the matching TEST secret key accepts: the live project refuses
 * it once CAPTCHA protection is on there.
 */
export const TURNSTILE_TEST_SITE_KEYS = {
  /** Always passes, never shows anything: local development and tests. */
  passInvisible: "1x00000000000000000000BB",
  /** Always passes, shows the widget. */
  passVisible: "1x00000000000000000000AA",
  /** Always fails, invisible: tries the failure path by hand. */
  blockInvisible: "2x00000000000000000000BB",
  /** Always asks for a tap: tries the "Quick check" sheet by hand. */
  forceInteractive: "3x00000000000000000000FF",
} as const;
