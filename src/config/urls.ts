/**
 * The project's public web addresses, defined once.
 *
 * - SITE_ORIGIN: the website (GitHub Pages): the privacy policy, the
 *   handbook page, the brand images.
 * - APP_ORIGIN: the web app itself (Cloudflare Pages, served at the root).
 *   Before 2026-10 it lived at bumelerze.com/app; that path now forwards
 *   here. The SHORT LINKS the app shares and prints in QR codes live here
 *   too (D-1, owner-approved 2026-10-14): a link that lands on the app
 *   directly carries the app's own page metadata (link previews in
 *   messengers) and never depends on the website's forwarding. The old
 *   bumelerze.com/e/, /u/ and /join links keep forwarding here.
 */
export const SITE_ORIGIN = "https://bumelerze.com";
export const APP_ORIGIN = "https://app.bumelerze.com";

/** app.bumelerze.com/e/<eventId> -> the app's /event/<eventId> (app/e/[id].tsx) */
export const SHORT_EVENT_URL_BASE = `${APP_ORIGIN}/e`;
/** app.bumelerze.com/u/<username>: the app's own public profile route */
export const SHORT_PROFILE_URL_BASE = `${APP_ORIGIN}/u`;
/** app.bumelerze.com/home/join?code=…&key=…: the app's own join route */
export const SHORT_JOIN_URL = `${APP_ORIGIN}/home/join`;

/** Pages on the website the app links to. */
export const PRIVACY_POLICY_URL = `${SITE_ORIGIN}/privacy.html`;
export const HANDBOOK_URL = `${SITE_ORIGIN}/handbook.html`;

/** The picture a shared link unfurls to (the website's own Open Graph image). */
export const OG_IMAGE_URL = `${SITE_ORIGIN}/og-image.jpg`;
/** One sentence for link previews, in English for every reader (the page is
 * served once for all languages). */
export const APP_SHARE_DESCRIPTION =
  "Earthquakes in Kurdistan and Iraq — share your experience, see shaking maps, stay ready.";
