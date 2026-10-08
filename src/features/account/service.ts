import Constants from "expo-constants";
import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import { removeOwnedHomePhotoFiles } from "@/features/building/transport";
import {
  aboutChanged,
  aboutErrorCode,
  saveProfileAbout,
  type AboutInput,
  type ProfileAbout,
} from "./about";
import { SupabaseGuidelinesTransport } from "@/features/guidelines/transport";
import { isValidUsername, normalizeUsername } from "@/features/community/username";
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
  type PrivateProfile,
  type Profile,
} from "./types";
import { isAcceptablePassword, isPlausibleEmail } from "./validation";

export { isAcceptablePassword, isPlausibleEmail };

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

export function toAccountError(
  error: unknown,
  fallback: AccountErrorCode = "unknown",
): AccountError {
  if (error instanceof AccountError) {
    return error;
  }
  const e = asAuthLike(error);
  const message = e.message ?? "";
  if (isEmailTakenError(error)) {
    return new AccountError("email_taken", message);
  }
  if (e.code === "same_password" || /different from the old password/i.test(message)) {
    return new AccountError("same_password", message);
  }
  if (
    e.code === "weak_password" ||
    /password should be at least|weak password/i.test(message)
  ) {
    return new AccountError("weak_password", message);
  }
  if (e.code === "invalid_credentials" || /invalid login credentials/i.test(message)) {
    return new AccountError("invalid_credentials", message);
  }
  if (
    e.code === "reauthentication_needed" ||
    e.code === "reauthentication_not_valid" ||
    /reauthentication/i.test(message)
  ) {
    return new AccountError("reauth_needed", message);
  }
  if (
    e.status === 429 ||
    e.code === "over_email_send_rate_limit" ||
    e.code === "over_request_rate_limit" ||
    /rate limit|too many requests|security purposes/i.test(message)
  ) {
    return new AccountError("rate_limited", message);
  }
  if (
    e.code === "email_address_invalid" ||
    /invalid.*email|email.*invalid/i.test(message)
  ) {
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

/** The profile write can fail on the username rules: unique index (taken),
 * the reserved-name guard, or the format check. */
export function toUsernameAwareError(error: unknown): AccountError {
  const e = asAuthLike(error);
  const message = e.message ?? "";
  if (e.code === "23505" && /username/i.test(message)) {
    return new AccountError("username_taken", message);
  }
  if (/username_reserved/.test(message)) {
    return new AccountError("username_reserved", message);
  }
  // Migration 0052: a display name that imitates the team ("Bumelerze",
  // "Official", "Admin", ...).
  if (/display_name_reserved/.test(message)) {
    return new AccountError("name_reserved", message);
  }
  if (/profiles_username_format/.test(message)) {
    return new AccountError("username_invalid", message);
  }
  // Migration 0058: name change limits, bio/city checks, restriction.
  const about = aboutErrorCode(message);
  if (about) {
    return about;
  }
  return toAccountError(error);
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
// Email + password (no emails are sent: Supabase "Confirm email" is off)
// ---------------------------------------------------------------------------

/**
 * Creates the account by upgrading this install's anonymous user in place:
 * one `auth.updateUser({ email, password })` call. The user id never changes,
 * so every guest report/comment/home stays attached. With "Confirm email" off
 * in Supabase Auth the change applies at once and nothing is mailed; the
 * address is therefore unverified, which is why the form asks for it twice.
 * (A server that still has confirmation on would only record a pending
 * `new_email` — detected below and reported instead of pretending success.)
 */
export async function createAccountWithPassword(
  rawEmail: string,
  password: string,
): Promise<void> {
  const client = requireClient();
  const email = rawEmail.trim();
  if (!isPlausibleEmail(email)) {
    throw new AccountError("invalid_email");
  }
  if (!isAcceptablePassword(password)) {
    throw new AccountError("weak_password");
  }

  try {
    await signInAnonymously();
  } catch (error) {
    throw toAccountError(error, "no_session");
  }
  const user = await currentUser(client);
  if (!user || user.is_anonymous !== true) {
    // Nothing to upgrade: no session, or this device already has an account.
    throw new AccountError(user ? "unknown" : "no_session");
  }

  const { data, error } = await client.auth.updateUser({ email, password });
  if (error) {
    throw toAccountError(error);
  }
  const updated = data?.user;
  if (!updated || (updated.email ?? "").toLowerCase() !== email.toLowerCase()) {
    throw new AccountError("setup_incomplete");
  }
  // The access token still says is_anonymous = true; row-level security
  // (is_real_account) reads that claim, so get a fresh token now. Best effort:
  // offline right here only delays the claim until the next automatic refresh.
  await client.auth.refreshSession().catch(() => undefined);
}

export interface SignInResult {
  userId: string | null;
  /** Items moved from this device's anonymous identity into the account. */
  claimed: number;
}

/**
 * Signs in to an existing account on this device. The device's guest session
 * is replaced (as the old email-code sign-in did), then reports made from
 * this install are moved into the account via `claim_device_reports`.
 */
export async function signInWithPassword(
  rawEmail: string,
  password: string,
): Promise<SignInResult> {
  const client = requireClient();
  const email = rawEmail.trim();
  if (!isPlausibleEmail(email)) {
    throw new AccountError("invalid_email");
  }
  if (password.length === 0) {
    throw new AccountError("invalid_credentials");
  }
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw toAccountError(error);
  }
  const userId = data?.user?.id ?? data?.session?.user?.id ?? null;
  const claimed = await claimThisDevicesReports(client);
  return { userId, claimed };
}

/** Sets or changes the signed-in account's password (accounts made by email
 * link have none yet). `auth.updateUser({ password })` sends no email while
 * "Secure password change" is off. */
export async function setAccountPassword(password: string): Promise<void> {
  const client = requireClient();
  if (!isAcceptablePassword(password)) {
    throw new AccountError("weak_password");
  }
  await requireAccountUser(client);
  const { error } = await client.auth.updateUser({ password });
  if (error) {
    throw toAccountError(error);
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
  const baseUrl =
    (Constants.expoConfig?.experiments as { baseUrl?: string } | undefined)?.baseUrl ??
    "";
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
  username?: string | null;
  is_private?: boolean | null;
}

interface PrivateRow {
  profession: string | null;
  locale: string | null;
  terms_version: string | null;
  terms_accepted_at: string | null;
  research_consent_version: string | null;
  research_consent_at: string | null;
  hide_badges?: boolean | null;
}

const PRIVATE_COLUMNS =
  "profession, locale, terms_version, terms_accepted_at, research_consent_version, research_consent_at";

export async function loadProfile(
  userId: string,
): Promise<{ profile: Profile | null; privateProfile: PrivateProfile | null }> {
  const client = requireClient();
  const [profileRes, privateRes] = await Promise.all([
    client
      .from("profiles")
      .select("user_id, display_name, avatar_path, username, is_private")
      .eq("user_id", userId)
      .maybeSingle(),
    client
      .from("profile_private")
      .select(`${PRIVATE_COLUMNS}, hide_badges`)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  // Before migration 0045 the username / private / hide_badges columns do not
  // exist and those reads fail; read the old columns instead so a missing
  // migration never costs someone their profile.
  let communityReady = true;
  let profileData = profileRes.data as ProfileRow | null;
  let profileError = profileRes.error;
  if (profileError) {
    communityReady = false;
    const legacy = await client
      .from("profiles")
      .select("user_id, display_name, avatar_path")
      .eq("user_id", userId)
      .maybeSingle();
    profileData = legacy.data as ProfileRow | null;
    profileError = legacy.error;
  }
  if (profileError) {
    throw toAccountError(profileError);
  }

  let privateData = privateRes.data as PrivateRow | null;
  let privateError = privateRes.error;
  if (privateError) {
    const legacy = await client
      .from("profile_private")
      .select(PRIVATE_COLUMNS)
      .eq("user_id", userId)
      .maybeSingle();
    privateData = legacy.data as PrivateRow | null;
    privateError = legacy.error;
  }
  const privateRow = privateError ? null : privateData;

  return {
    profile: profileData
      ? {
          userId: profileData.user_id,
          displayName: profileData.display_name,
          avatarPath: profileData.avatar_path,
          username: profileData.username ?? null,
          isPrivate: profileData.is_private === true,
          communityReady,
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
          hideBadges: privateRow.hide_badges === true,
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
  /** Public @handle. Sent only when it differs from the stored one. */
  username?: string | null;
  /** Private account switch. Sent only when it differs from the stored one. */
  isPrivate?: boolean;
  /** Hide milestone badges on the public profile. Sent only when changed. */
  hideBadges?: boolean;
  /** Current UI language (stored as the user's locale). */
  locale: string;
  /** Bio and city label (migration 0058). Sent only when they changed, and
   * only when the server has them (`undefined` before 0058). */
  about?: AboutInput;
  /** What is stored now, so unchanged consents keep their original time. */
  previous?: {
    profile: Profile | null;
    privateProfile: PrivateProfile | null;
    about?: ProfileAbout | null;
  };
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
  // The community fields are sent only when they changed, so saving a profile
  // never touches columns the server may not have yet (before migration 0045).
  const wantedUsername = normalizeUsername(input.username ?? "");
  if (
    wantedUsername !== "" &&
    wantedUsername !== (input.previous?.profile?.username ?? "")
  ) {
    if (!isValidUsername(wantedUsername)) {
      throw new AccountError("username_invalid");
    }
    profileRow.username = wantedUsername;
  }
  if (
    input.isPrivate !== undefined &&
    input.isPrivate !== (input.previous?.profile?.isPrivate ?? false)
  ) {
    profileRow.is_private = input.isPrivate;
  }
  const { error: profileError } = await client
    .from("profiles")
    .upsert(profileRow, { onConflict: "user_id" });
  if (profileError) {
    throw toUsernameAwareError(profileError);
  }

  const nowIso = new Date().toISOString();
  const privateRow: Record<string, unknown> = {
    user_id: user.id,
    profession: input.profession,
    locale: (SUPPORTED_LOCALES as readonly string[]).includes(input.locale)
      ? input.locale
      : null,
  };
  if (previousPrivate?.termsVersion !== TERMS_VERSION) {
    privateRow.terms_version = TERMS_VERSION;
    privateRow.terms_accepted_at = nowIso;
  }
  if (
    input.hideBadges !== undefined &&
    input.hideBadges !== (previousPrivate?.hideBadges ?? false)
  ) {
    privateRow.hide_badges = input.hideBadges;
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

  // The terms checkbox covers the community guidelines and "I am 13 or older"
  // (migration 0056), so a first acceptance of the terms records both. Best
  // effort: if it fails the person is simply asked before their first comment.
  if (previousPrivate?.termsVersion !== TERMS_VERSION) {
    await SupabaseGuidelinesTransport.accept("signup").catch(() => undefined);
  }

  // Bio and city go through their own call (the columns are not directly
  // writable in a way the read rules could miss); only when they changed.
  if (input.about && aboutChanged(input.about, input.previous?.about ?? null)) {
    await saveProfileAbout(input.about);
  }

  // The new row is saved; the old file is garbage now (best effort).
  if (avatarPath !== undefined && previousAvatar && previousAvatar !== avatarPath) {
    await client.storage
      .from(AVATARS_BUCKET)
      .remove([previousAvatar])
      .catch(() => undefined);
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
  if (
    fromData === "image/png" ||
    fromData === "image/webp" ||
    fromData === "image/jpeg"
  ) {
    return fromData;
  }
  const lower = uri.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

async function uploadAvatar(
  client: SupabaseClient,
  userId: string,
  uri: string,
): Promise<string> {
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

/** Deletes avatar files and the photo files of the homes this person owns,
 * then the account via the `delete_my_account` RPC (profile, posts, comments
 * blanked, owned homes, auth user; see migration 0056 for the full list), then
 * returns this device to anonymous. */
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

  // The server deletes the owned homes; their photo files are ours to remove
  // (SQL cannot delete storage objects). Never blocks the deletion.
  await removeOwnedHomePhotoFiles(client, user.id);

  const { error } = await client.rpc("delete_my_account");
  if (error) {
    throw toAccountError(error);
  }
  await returnToAnonymous(client);
}
