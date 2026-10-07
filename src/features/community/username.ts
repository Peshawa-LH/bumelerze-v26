import { USERNAME_MAX, USERNAME_MIN, USERNAME_PATTERN } from "./constants";

/** What the database stores: no spaces, no leading @, lowercase. */
export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@+/, "").toLowerCase();
}

export function isValidUsername(raw: string): boolean {
  return USERNAME_PATTERN.test(normalizeUsername(raw));
}

const LEFT_TO_RIGHT_ISOLATE = "⁦";
const POP_DIRECTIONAL_ISOLATE = "⁩";

/**
 * "@name" for display. Usernames are always Latin, so inside a right-to-left
 * sentence (Sorani, Arabic) the "@" and the dots would reorder; an isolate
 * keeps the handle intact and in place.
 */
export function formatUsername(username: string): string {
  return `${LEFT_TO_RIGHT_ISOLATE}@${username}${POP_DIRECTIONAL_ISOLATE}`;
}

function randomDigits(): string {
  return String(1000 + Math.floor(Math.random() * 9000));
}

/**
 * A username suggestion from a display name: Latin letters and digits only,
 * words joined by a dot. A name with no Latin letters (Sorani, Arabic) gets
 * "user" and four digits. Always valid; availability is checked separately.
 */
export function suggestUsername(
  displayName: string,
  digits: () => string = randomDigits,
): string {
  const ascii = displayName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  let base = ascii.slice(0, USERNAME_MAX);
  if (base.length < USERNAME_MIN) {
    base = `${base.replace(/\./g, "")}user`.slice(0, USERNAME_MAX - 4);
    base = `${base}${digits()}`;
  }
  return base.slice(0, USERNAME_MAX).replace(/\.+$/, "") || `user${digits()}`;
}
