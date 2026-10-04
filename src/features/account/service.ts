import Constants from "expo-constants";
import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import { getDeviceId } from "@/features/felt/device-id";
import { SUPPORTED_LOCALES } from "@/i18n";
import { dataUriMimeType, toDurablePhotoUri } from "@/lib/durable-photo-uri";
import {
  getSupabaseClient,
  resetAnonymousSignIn,
  signInAnonymously,
} from "@/lib/supabase";
import {
  AVATARS_BUCKET,
  AVATAR_MAX_BYTES,
  AVATAR_MAX_EDGE_PX,
  DISPLAY_NAME_MAX,
  DISPLAY_NAME_MIN,
  RESEARCH_CONSENT_VERSION,
  TERMS_VERSION,
  isProfession,
  type Profession,
} from "./constants";
import {
  AccountError,
  type AccountErrorCode,
  type AvatarChange,
  type EmailAuthMode,
  type PrivateProfile,
  type Profile,
} from "./types";

/**
 * Accounts phase 1 service. Screens never call Supabase directly; they call
 * these functions. An account is the install's anonymous Supabase user,
 * upgraded (email / social identity linked), so `user_id` never changes and
 * past reports stay attached. See migration 0035 for the tables, bucket and
 * RPCs used here.
 */

function requireClient(): SupabaseClient {
  const client = getSupabaseClient();
  if (!client) {
    throw new AccountError("unconfigured");
  }
  return client;
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

interface AuthLikeError {
  message?: string;
  status?: number;
  code?: string;
  name?: string;
}

function asAuthLike(error: unknown): AuthLikeError {
  return typeof error === "object" && error !== null ? (error as AuthLikeError) : {};
}

/** The email already belongs to another user (Supabase `email_exists`, 422). */
export function isEmailTakenError(error: unknown): boolean {
  const e = asAuthLike(error);
  if (e.code === "email_exists" || e.code === "identity_already_exists") {
    return true;
  }
  return /already (been )?registered|already exists|email_exists/i.test(e.message ?? "");
}

export function toAccountError(error: unknown, fallback: AccountErrorCode = "unknown"): AccountError {
  if (error instanceof AccountError) {
    return error;
  }
  const e = asAuthLike(error);
  const message = e.message ?? "";
  if (
    e.status === 429 ||
    e.code === "over_email_send_rate_limit" ||
    e.code === "over_request_rate_limit" ||
    /rate limit|too many requests|security purposes/i.test(message)
  ) {
    return new AccountError("rate_limited", message);
  }
  if (e.code === "otp_expired" || /token has expired|otp.*(expired|invalid)|invalid.*(token|otp)/i.test(message)) {
    return new AccountError("invalid_code", message);
  }
  if (e.code === "email_address_invalid" || e.code === "validation_failed" || /invalid.*email|email.*invalid/i.test(message)) {
    return new AccountError("invalid_email", message);
  }
  if (
    e.name === "AuthRetryableFetchError" ||
    e.status === 0 ||
    /network|failed to fetch|fetch failed/i.test(message)
  ) {
    return new AccountError("network", message);
  }
  return new AccountError(fallback, message);
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

export function isAccountUser(user: User | null | undefined): boolean {
  return !!user && user.is_anonymous !== true;
}

async function currentUser(client: SupabaseClient): Promise<User | null> {
  const { data } = await client.auth.getSession();
  return data.session?.user ?? null;
}

async function requireAccountUser(client: SupabaseClient): Promise<User> {
  const user = await currentUser(client);
  if (!user || !isAccountUser(user)) {
    throw new AccountError("no_session");
  }
  return user;
}

// ---------------------------------------------------------------------------
// Email code sign-in
// ---------------------------------------------------------------------------

/**
 * Where the emailed sign-in link sends the browser back to: this site's
 * origin + the app base path (EXPO_BASE_URL, e.g. "/app") + the callback
 * route. Web only; native has no link target yet, so it is left undefined
 * and Supabase uses its default Site URL.
 */
export function getEmailRedirectUrl(): string | undefined {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return undefined;
  }
  const basePath = (process.env.EXPO_BASE_URL ?? "").replace(/\/$/, "");
  return `${window.location.origin}${basePath}/account/callback`;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isPlausibleEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

/**
 * Sends the one-time code. For this install's anonymous user the email is
 * attached to it (`updateUser`), which makes it an account with the same
 * user id once the code is confirmed. If the address already belongs to an
 * account, falls back to a plain sign-in code (`shouldCreateUser: false`)
 * and tells the caller so it verifies with the matching OTP type.
 */
export async function requestEmailCode(rawEmail: string): Promise<{ mode: EmailAuthMode }> {
  const client = requireClient();
  const email = rawEmail.trim();
  if (!isPlausibleEmail(email)) {
    throw new AccountError("invalid_email");
  }

  try {
    await signInAnonymously();
  } catch (error) {
    throw toAccountError(error, "no_session");
  }
  const user = await currentUser(client);

  if (user && user.is_anonymous === true) {
    const emailRedirectTo = getEmailRedirectUrl();
    const { error } = emailRedirectTo
      ? await client.auth.updateUser({ email }, { emailRedirectTo })
      : await client.auth.updateUser({ email });
    if (!error) {
      return { mode: "upgrade" };
    }
    if (!isEmailTakenError(error)) {
      throw toAccountError(error);
    }
    // Falls through: the email is already an account — sign into it.
  }

  const redirectTo = getEmailRedirectUrl();
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, ...(redirectTo ? { emailRedirectTo: redirectTo } : {}) },
  });
  if (error) {
    throw toAccountError(error);
  }
  return { mode: "signin" };
}

export interface VerifyResult {
  userId: string | null;
  /** Items moved from this device's anonymous identity into the account
   * (sign-in path only; 0 for an upgrade, where nothing needs to move). */
  claimed: number;
}

/** Confirms the emailed code. See `requestEmailCode` for the two modes. */
export async function verifyEmailCode(
  rawEmail: string,
  rawCode: string,
  mode: EmailAuthMode,
): Promise<VerifyResult> {
  const client = requireClient();
  const email = rawEmail.trim();
  const token = rawCode.replace(/\s+/g, "");

  const { data, error } = await client.auth.verifyOtp({
    email,
    token,
    type: mode === "upgrade" ? "email_change" : "email",
  });
  if (error) {
    throw toAccountError(error, "invalid_code");
  }
  const userId = data?.user?.id ?? data?.session?.user?.id ?? null;

  let claimed = 0;
  if (mode === "signin") {
    claimed = await claimThisDevicesReports(client);
  }
  return { userId, claimed };
}

/** An error carried back in the callback URL (`error_description` in the
 * hash or the query string), e.g. an expired or already-used link. */
export function readAuthUrlError(): string | null {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return null;
  }
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  return (
    hash.get("error_description") ??
    hash.get("error") ??
    query.get("error_description") ??
    query.get("error") ??
    null
  );
}

export type EmailLinkResult =
  | { status: "ok"; userId: string; hasProfile: boolean; claimed: number }
  | { status: "expired" };

const LINK_WAIT_MS = 8000;
const LINK_POLL_MS = 400;

/**
 * Finishes an email-link sign-in on /account/callback. The Supabase client
 * reads the session tokens out of the URL itself (web); this waits for that
 * session, then moves this device's anonymous reports into the account
 * (a no-op for an upgraded user: those rows are already theirs) and tells
 * the caller whether a profile row exists yet.
 */
export async function completeEmailLink(waitMs: number = LINK_WAIT_MS): Promise<EmailLinkResult> {
  const client = requireClient();
  if (readAuthUrlError()) {
    return { status: "expired" };
  }
  const deadline = Date.now() + waitMs;
  for (;;) {
    const user = await currentUser(client);
    if (user && isAccountUser(user)) {
      const claimed = await claimThisDevicesReports(client);
      let hasProfile = false;
      try {
        hasProfile = (await loadProfile(user.id)).profile !== null;
      } catch {
        // Offline right after sign-in: send them to the profile form, which
        // can be saved later; better than a dead end.
      }
      return { status: "ok", userId: user.id, hasProfile, claimed };
    }
    if (Date.now() >= deadline) {
      return { status: "expired" };
    }
    await new Promise((resolve) => setTimeout(resolve, LINK_POLL_MS));
  }
}

/** Moves this install's anonymous reports/comments/feedback into the
 * signed-in account. Never throws: failing to move must not undo a
 * successful sign-in (the rows simply stay anonymous). */
export async function claimThisDevicesReports(
  client: SupabaseClient = requireClient(),
): Promise<number> {
  try {
    const deviceId = await getDeviceId();
    const { data, error } = await client.rpc("claim_device_reports", {
      p_device_id: deviceId,
    });
    if (error) {
      return 0;
    }
    return typeof data === "number" ? data : 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Google / Apple (flag-gated in the UI; finished when providers exist)
// ---------------------------------------------------------------------------

export type OAuthProvider = "google" | "apple";

/** Where the provider sends the browser back to: the current origin plus
 * the app's base path (e.g. https://bumelerze.com/app). */
export function getWebRedirectUrl(): string {
  const baseUrl = (Constants.expoConfig?.experiments as { baseUrl?: string } | undefined)?.baseUrl ?? "";
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${baseUrl}`;
}

/**
 * Anonymous user -> `linkIdentity` (keeps the user id; needs "manual
 * linking" enabled in Supabase). Otherwise -> `signInWithOAuth`. Web only
 * for now: native needs the in-app browser flow of the dev build.
 * TODO(providers): after redirect the session arrives in the URL, which the
 * client ignores today (`detectSessionInUrl: false`) — enable that on web
 * and call `claimThisDevicesReports` on return when Google is configured.
 */
export async function startOAuth(provider: OAuthProvider): Promise<void> {
  const client = requireClient();
  if (Platform.OS !== "web") {
    throw new AccountError("oauth_unavailable");
  }
  const redirectTo = getWebRedirectUrl();
  const user = await currentUser(client);
  const { error } =
    user && user.is_anonymous === true
      ? await client.auth.linkIdentity({ provider, options: { redirectTo } })
      : await client.auth.signInWithOAuth({ provider, options: { redirectTo } });
  if (error) {
    throw toAccountError(error);
  }
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

interface ProfileRow {
  user_id: string;
  display_name: string;
  avatar_path: string | null;
}

interface PrivateRow {
  profession: string | null;
  locale: string | null;
  terms_version: string | null;
  terms_accepted_at: string | null;
  research_consent_version: string | null;
  research_consent_at: string | null;
}

export async function loadProfile(
  userId: string,
): Promise<{ profile: Profile | null; privateProfile: PrivateProfile | null }> {
  const client = requireClient();
  const [profileRes, privateRes] = await Promise.all([
    client
      .from("profiles")
      .select("user_id, display_name, avatar_path")
      .eq("user_id", userId)
      .maybeSingle(),
    client
      .from("profile_private")
      .select(
        "profession, locale, terms_version, terms_accepted_at, research_consent_version, research_consent_at",
      )
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (profileRes.error) {
    throw toAccountError(profileRes.error);
  }
  const profileRow = profileRes.data as ProfileRow | null;
  const privateRow = privateRes.error ? null : (privateRes.data as PrivateRow | null);
  return {
    profile: profileRow
      ? {
          userId: profileRow.user_id,
          displayName: profileRow.display_name,
          avatarPath: profileRow.avatar_path,
        }
      : null,
    privateProfile: privateRow
      ? {
          profession: isProfession(privateRow.profession) ? privateRow.profession : null,
          locale: privateRow.locale,
          termsVersion: privateRow.terms_version,
          termsAcceptedAt: privateRow.terms_accepted_at,
          researchConsentVersion: privateRow.research_consent_version,
          researchConsentAt: privateRow.research_consent_at,
        }
      : null,
  };
}

/** Trimmed length check shared with the form (same rule as the DB check). */
export function validateDisplayName(name: string): boolean {
  const length = name.trim().length;
  return length >= DISPLAY_NAME_MIN && length <= DISPLAY_NAME_MAX;
}

export interface SaveProfileInput {
  displayName: string;
  profession: Profession | null;
  /** Required. */
  termsAccepted: boolean;
  /** Optional research-use consent. */
  researchConsent: boolean;
  avatar: AvatarChange;
  /** Current UI language (stored as the user's locale). */
  locale: string;
  /** What is stored now, so unchanged consents keep their original time. */
  previous?: { profile: Profile | null; privateProfile: PrivateProfile | null };
}

export async function saveProfile(input: SaveProfileInput): Promise<void> {
  const client = requireClient();
  const name = input.displayName.trim();
  if (!validateDisplayName(name)) {
    throw new AccountError("name_length");
  }
  if (!input.termsAccepted) {
    throw new AccountError("terms_required");
  }
  const user = await requireAccountUser(client);
  const previousAvatar = input.previous?.profile?.avatarPath ?? null;
  const previousPrivate = input.previous?.privateProfile ?? null;

  let avatarPath: string | null | undefined; // undefined = leave unchanged
  if (input.avatar.kind === "new") {
    avatarPath = await uploadAvatar(client, user.id, input.avatar.uri);
  } else if (input.avatar.kind === "remove") {
    avatarPath = null;
  }

  const profileRow: Record<string, unknown> = {
    user_id: user.id,
    display_name: name,
  };
  if (avatarPath !== undefined) {
    profileRow.avatar_path = avatarPath;
  }
  const { error: profileError } = await client
    .from("profiles")
    .upsert(profileRow, { onConflict: "user_id" });
  if (profileError) {
    throw toAccountError(profileError);
  }

  const nowIso = new Date().toISOString();
  const privateRow: Record<string, unknown> = {
    user_id: user.id,
    profession: input.profession,
    locale: (SUPPORTED_LOCALES as readonly string[]).includes(input.locale) ? input.locale : null,
  };
  if (previousPrivate?.termsVersion !== TERMS_VERSION) {
    privateRow.terms_version = TERMS_VERSION;
    privateRow.terms_accepted_at = nowIso;
  }
  if (!input.researchConsent) {
    privateRow.research_consent_version = null;
    privateRow.research_consent_at = null;
  } else if (previousPrivate?.researchConsentVersion !== RESEARCH_CONSENT_VERSION) {
    privateRow.research_consent_version = RESEARCH_CONSENT_VERSION;
    privateRow.research_consent_at = nowIso;
  }
  const { error: privateError } = await client
    .from("profile_private")
    .upsert(privateRow, { onConflict: "user_id" });
  if (privateError) {
    throw toAccountError(privateError);
  }

  // The new row is saved; the old file is garbage now (best effort).
  if (avatarPath !== undefined && previousAvatar && previousAvatar !== avatarPath) {
    await client.storage.from(AVATARS_BUCKET).remove([previousAvatar]).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

/**
 * Picks a square photo from the library. On web it is downscaled to
 * 256 px JPEG in a canvas (`toDurablePhotoUri`). On native no image
 * manipulation module is installed (deliberately: no new native deps), so
 * the picker's own crop + low JPEG quality is used and `uploadAvatar`
 * enforces the 1 MB bucket limit instead of resizing.
 * Returns the local uri, or null if the user cancelled.
 */
export async function pickAvatar(): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.4,
  });
  if (result.canceled) {
    return null;
  }
  const asset = result.assets[0];
  if (!asset) {
    return null;
  }
  return await toDurablePhotoUri(asset, { maxEdgePx: AVATAR_MAX_EDGE_PX, quality: 0.8 });
}

async function readImageBody(uri: string): Promise<Blob | ArrayBuffer> {
  if (Platform.OS === "web") {
    return await (await fetch(uri)).blob();
  }
  return await new File(uri).arrayBuffer();
}

function bodySize(body: Blob | ArrayBuffer): number {
  return body instanceof ArrayBuffer ? body.byteLength : body.size;
}

function avatarContentType(uri: string): string {
  const fromData = dataUriMimeType(uri);
  if (fromData === "image/png" || fromData === "image/webp" || fromData === "image/jpeg") {
    return fromData;
  }
  const lower = uri.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

async function uploadAvatar(client: SupabaseClient, userId: string, uri: string): Promise<string> {
  const body = await readImageBody(uri);
  if (bodySize(body) > AVATAR_MAX_BYTES) {
    throw new AccountError("avatar_too_large");
  }
  const path = `${userId}/avatar-${Date.now()}.jpg`;
  const { error } = await client.storage.from(AVATARS_BUCKET).upload(path, body, {
    contentType: avatarContentType(uri),
    upsert: false,
  });
  if (error) {
    throw toAccountError(error);
  }
  return path;
}

/** Public URL of an avatar path, or null when there is none / no client. */
export function getAvatarUrl(avatarPath: string | null | undefined): string | null {
  if (!avatarPath) {
    return null;
  }
  const client = getSupabaseClient();
  if (!client) {
    return null;
  }
  return client.storage.from(AVATARS_BUCKET).getPublicUrl(avatarPath).data.publicUrl;
}

// ---------------------------------------------------------------------------
// Sign out / delete
// ---------------------------------------------------------------------------

async function returnToAnonymous(client: SupabaseClient): Promise<void> {
  // 'local' clears this device's session even if the server no longer
  // knows the user (account deletion) or the network is down.
  await client.auth.signOut({ scope: "local" }).catch(() => undefined);
  resetAnonymousSignIn();
  try {
    await signInAnonymously();
  } catch {
    // Offline: the app keeps working without a session and signs in
    // anonymously on the next write that needs one.
  }
}

/** Signs out, then immediately becomes a fresh anonymous user so reporting
 * keeps working. The new install identity has no link to the account. */
export async function signOutAccount(): Promise<void> {
  const client = requireClient();
  await returnToAnonymous(client);
}

/** Deletes avatar files, then the account (profile rows, auth user) via the
 * `delete_my_account` RPC, then returns this device to anonymous. */
export async function deleteAccount(): Promise<void> {
  const client = requireClient();
  const user = await requireAccountUser(client);

  try {
    const { data: files } = await client.storage.from(AVATARS_BUCKET).list(user.id);
    const paths = (files ?? []).map((file) => `${user.id}/${file.name}`);
    if (paths.length > 0) {
      await client.storage.from(AVATARS_BUCKET).remove(paths);
    }
  } catch {
    // An orphaned avatar file must not block the deletion the user asked for.
  }

  const { error } = await client.rpc("delete_my_account");
  if (error) {
    throw toAccountError(error);
  }
  await returnToAnonymous(client);
}
