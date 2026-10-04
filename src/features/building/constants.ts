/** Values here mirror `supabase/migrations/0037_home_tags.sql` exactly. */

export const HOME_PHOTOS_BUCKET = "home-photos";
/** Bucket limit: 3 MB. */
export const HOME_PHOTO_MAX_BYTES = 3_145_728;
/** `home_tags.label` check: at most 60 characters. */
export const LABEL_MAX = 60;
/** `home_tags.unit_label` check: at most 40 characters. */
export const UNIT_LABEL_MAX = 40;
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
