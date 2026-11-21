import { AccountError, type AccountErrorCode } from "./types";

/**
 * Supabase Auth / PostgREST errors -> the account screens' one-line error
 * codes (`account.errors.*`). Its own module so that both the account
 * service and the two-step sign-in service (two-step.ts) use it without
 * importing each other; `service.ts` re-exports it.
 */

interface AuthLikeError {
  message?: string;
  status?: number;
  code?: string;
  name?: string;
}

export function asAuthLike(error: unknown): AuthLikeError {
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
  // Two-step sign-in is on and this session has not given a code yet
  // (Supabase `insufficient_aal`, e.g. a password change at aal1).
  if (e.code === "insufficient_aal" || /\bAAL2\b.*required/i.test(message)) {
    return new AccountError("code_needed", message);
  }
  // A wrong or stale 6-digit code (`mfa_verification_failed`, 422), or a
  // challenge that ran out before the code came.
  if (
    e.code === "mfa_verification_failed" ||
    e.code === "mfa_verification_rejected" ||
    e.code === "mfa_challenge_expired" ||
    /invalid totp code/i.test(message)
  ) {
    return new AccountError("wrong_code", message);
  }
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
  // A session the server no longer knows (signed out elsewhere, or ended
  // when two-step sign-in was turned on on another device).
  if (
    e.name === "AuthSessionMissingError" ||
    e.code === "session_not_found" ||
    /auth session missing/i.test(message)
  ) {
    return new AccountError("no_session", message);
  }
  return new AccountError(fallback, message);
}
