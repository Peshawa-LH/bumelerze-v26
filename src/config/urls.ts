/**
 * The project's public web addresses, defined once.
 *
 * - SITE_ORIGIN: the website (GitHub Pages). It also hosts the SHORT LINKS
 *   the app shares and prints in QR codes. They are meant never to change,
 *   whatever happens to the app's own address; the site forwards each one
 *   to the app (website-src/redirects.js).
 * - APP_ORIGIN: the web app itself (Cloudflare Pages, served at the root).
 *   Before 2026-10 it lived at bumelerze.com/app; that path now forwards
 *   here.
 */
export const SITE_ORIGIN = "https://bumelerze.com";
export const APP_ORIGIN = "https://app.bumelerze.com";

/** bumelerze.com/e/<eventId> -> app /event/<eventId> */
export const SHORT_EVENT_URL_BASE = `${SITE_ORIGIN}/e`;
/** bumelerze.com/u/<username> -> app /u/<username> */
export const SHORT_PROFILE_URL_BASE = `${SITE_ORIGIN}/u`;
/** bumelerze.com/join?code=…&key=… -> app /home/join?code=…&key=… */
export const SHORT_JOIN_URL = `${SITE_ORIGIN}/join`;

/** Pages on the website the app links to. */
export const PRIVACY_POLICY_URL = `${SITE_ORIGIN}/privacy.html`;
export const HANDBOOK_URL = `${SITE_ORIGIN}/handbook.html`;
