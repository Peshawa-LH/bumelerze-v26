/** Values here mirror `supabase/migrations/0037_home_tags.sql` exactly. */

export const HOME_PHOTOS_BUCKET = "home-photos";
/** Bucket limit: 3 MB. */
export const HOME_PHOTO_MAX_BYTES = 3_145_728;
/** `home_tags.label` check: at most 60 characters. */
export const LABEL_MAX = 60;
/** `home_tags.unit_label` check: at most 40 characters. */
export const UNIT_LABEL_MAX = 40;
/** The join link carries the code and the key and nothing else (never the location). */
export const JOIN_LINK_BASE = "https://bumelerze.com/app/home/join";
/** `create_home_tag` refuses a sixth active home per account. */
export const MAX_HOMES_PER_ACCOUNT = 5;
/** `request_join_home` allows this many tries per hour. */
export const JOIN_ATTEMPTS_PER_HOUR = 5;

/** Code `BMH-` + 6 Crockford base32 characters (no I, L, O, U). */
export const CODE_PATTERN = /^BMH-[0-9A-HJKMNP-TV-Z]{6}$/;
/** Join key: 8 Crockford base32 characters. */
export const KEY_PATTERN = /^[0-9A-HJKMNP-TV-Z]{8}$/;

/** Crockford reads O as 0 and I/L as 1; people type those by mistake. */
export function cleanCrockford(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

/** What a person typed into the code field, as the code the server expects. */
export function normalizeCode(value: string): string {
  const all = cleanCrockford(value);
  const body = all.length > 6 && all.startsWith("BMH") ? all.slice(3) : all;
  return `BMH-${body}`;
}

export function normalizeKey(value: string): string {
  return cleanCrockford(value);
}

export function isValidCode(value: string): boolean {
  return CODE_PATTERN.test(normalizeCode(value));
}

export function isValidKey(value: string): boolean {
  return KEY_PATTERN.test(normalizeKey(value));
}

/** The link the family QR code carries: the home code and the join key, which
 * is what a person would otherwise type. Never the location. */
export function buildJoinLink(code: string, key: string): string {
  return `${JOIN_LINK_BASE}?code=${encodeURIComponent(code)}&key=${encodeURIComponent(key)}`;
}

/** Reads a scanned QR text (or a pasted link) back into a code and key.
 * Accepts the web link and the app-scheme link; null for anything else or
 * when the code or key has the wrong shape. */
export function parseJoinLink(text: string): { code: string; key: string } | null {
  const trimmed = text.trim();
  const query = trimmed.includes("?") ? trimmed.slice(trimmed.indexOf("?") + 1) : "";
  if (!/\/home\/join\/?\?/.test(trimmed) || !query) {
    return null;
  }
  const params = new URLSearchParams(query.split("#")[0]);
  const code = normalizeCode(params.get("code") ?? "");
  const key = normalizeKey(params.get("key") ?? "");
  return CODE_PATTERN.test(code) && KEY_PATTERN.test(key) ? { code, key } : null;
}
