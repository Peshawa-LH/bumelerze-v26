import { z } from "zod";

import { SupabaseGuidelinesTransport } from "@/features/guidelines/transport";
import { getSupabaseClient } from "@/lib/supabase";
import { AccountError } from "./types";

/**
 * The profile's "about" part (migration 0058): a short bio and an optional
 * "Lives in <place>", plus when the next name change is possible. Read and
 * written only through `my_profile_about()` / `set_profile_about()`: the
 * columns are not readable directly, so the private-account, block and
 * suspension rules of `public_profile()` always apply to other readers.
 */

/** Mirrors `profiles_bio_check` and the guard in 0058 — change them together. */
export const BIO_MAX_LENGTH = 160;
/** Display name changes allowed per 30 days (0058). */
export const DISPLAY_NAME_CHANGES_PER_30_DAYS = 5;

/** A town from the app's own list: its id and the name shown when picked.
 * Deliberately no coordinates: there is nowhere to put them. */
export interface CityLabel {
  placeId: string;
  name: string;
}

export interface ProfileAbout {
  bio: string | null;
  city: CityLabel | null;
  pinnedPostId: string | null;
  /** When the @username may change again (UTC ms), or null: now. */
  usernameNextChangeAt: number | null;
  /** Display name changes left in the current 30 days. */
  displayNameChangesLeft: number;
  /** When the next display name change is possible if none are left. */
  displayNameNextChangeAt: number | null;
}

/** Same idea as `text_has_link()` in 0058: a scheme, www., or a word ending
 * in a common top-level domain. A false positive only asks to rephrase. */
const LINK_PATTERN =
  /((http|https):\/\/|www\.|[a-z0-9-]+\.(com|net|org|info|io|me|co|ly|app|xyz|site|online|link|krd|iq|gl|gg|tk|ru|ir|tr|de|uk)([^a-z0-9]|$))/i;

export function hasLink(text: string): boolean {
  return LINK_PATTERN.test(text);
}

/** The bio the server will store: whitespace folded to single spaces, trimmed. */
export function normalizeBio(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export type BioProblem = "bio_too_long" | "bio_link";

export function validateBio(text: string): BioProblem | null {
  const bio = normalizeBio(text);
  if (bio.length > BIO_MAX_LENGTH) {
    return "bio_too_long";
  }
  if (bio !== "" && hasLink(bio)) {
    return "bio_link";
  }
  return null;
}

const msSchema = z
  .string()
  .nullable()
  .optional()
  .transform((value) => {
    if (!value) return null;
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  });

const aboutSchema = z.object({
  bio: z.string().nullable().optional(),
  city_place_id: z.string().nullable().optional(),
  city_name: z.string().nullable().optional(),
  pinned_post_id: z.string().nullable().optional(),
  username_next_change_at: msSchema,
  display_name_changes_left: z.coerce
    .number()
    .int()
    .catch(DISPLAY_NAME_CHANGES_PER_30_DAYS)
    .optional(),
  display_name_next_change_at: msSchema,
});

export function parseProfileAbout(data: unknown): ProfileAbout | null {
  const parsed = aboutSchema.safeParse(data);
  if (!parsed.success) {
    return null;
  }
  const a = parsed.data;
  return {
    bio: a.bio ? a.bio : null,
    city:
      a.city_place_id && a.city_name
        ? { placeId: a.city_place_id, name: a.city_name }
        : null,
    pinnedPostId: a.pinned_post_id ?? null,
    usernameNextChangeAt: a.username_next_change_at,
    displayNameChangesLeft:
      a.display_name_changes_left ?? DISPLAY_NAME_CHANGES_PER_30_DAYS,
    displayNameNextChangeAt: a.display_name_next_change_at,
  };
}

/** `unavailable`: the server has no migration 0058 yet (the form then hides
 * the bio and city fields instead of failing to save). */
export type AboutLoad =
  { status: "ready"; about: ProfileAbout | null } | { status: "unavailable" };

function isMissingFunction(error: { code?: string; status?: number } | null): boolean {
  return (
    !!error &&
    (error.code === "PGRST202" || error.code === "42883" || error.status === 404)
  );
}

export async function loadProfileAbout(): Promise<AboutLoad> {
  const client = getSupabaseClient();
  if (!client) {
    return { status: "unavailable" };
  }
  const { data, error } = await client.rpc("my_profile_about");
  if (isMissingFunction(error)) {
    return { status: "unavailable" };
  }
  if (error) {
    throw new AccountError("unknown", error.message);
  }
  return { status: "ready", about: parseProfileAbout(data) };
}

export interface AboutInput {
  bio: string;
  city: CityLabel | null;
}

/** True when the about fields differ from what is stored. */
export function aboutChanged(next: AboutInput, previous: ProfileAbout | null): boolean {
  const bio = normalizeBio(next.bio);
  return (
    bio !== (previous?.bio ?? "") ||
    (next.city?.placeId ?? null) !== (previous?.city?.placeId ?? null) ||
    (next.city?.name ?? null) !== (previous?.city?.name ?? null)
  );
}

/** Maps the 0058 refusals of a profile write to account error codes. */
export function aboutErrorCode(message: string): AccountError | null {
  for (const [token, code] of [
    ["bio_link", "bio_link"],
    ["bio_too_long", "bio_too_long"],
    ["city_invalid", "city_invalid"],
    ["username_change_limit", "username_change_limit"],
    ["display_name_change_limit", "name_change_limit"],
    ["account_restricted", "restricted"],
  ] as const) {
    if (message.includes(token)) {
      return new AccountError(code, message);
    }
  }
  return null;
}

/**
 * Saves the bio and the city label: text, a place id and a place name, and
 * nothing else (no coordinates exist in this call). Saving needs the
 * community guidelines, which the profile form's required terms checkbox
 * covers, so a first refusal records that agreement and tries once more.
 */
export async function saveProfileAbout(input: AboutInput): Promise<void> {
  const client = getSupabaseClient();
  if (!client) {
    throw new AccountError("unconfigured");
  }
  const args = {
    p_bio: normalizeBio(input.bio) || null,
    p_city_place_id: input.city?.placeId ?? null,
    p_city_name: input.city?.name ?? null,
  };
  let { error } = await client.rpc("set_profile_about", args);
  if (error && /guidelines_required/.test(error.message ?? "")) {
    await SupabaseGuidelinesTransport.accept("signup");
    ({ error } = await client.rpc("set_profile_about", args));
  }
  if (error) {
    throw (
      aboutErrorCode(error.message ?? "") ?? new AccountError("unknown", error.message)
    );
  }
}
