import { isValidUsername } from "@/features/community/username";
import {
  DISPLAY_NAME_MAX,
  DISPLAY_NAME_MIN,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "./constants";
import type { AccountErrorCode } from "./types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isPlausibleEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

/** 8..72 characters (72 is GoTrue's bcrypt limit). Spaces count: people paste
 * passphrases, and trimming would silently change what they typed. */
export function isAcceptablePassword(value: string): boolean {
  return value.length >= PASSWORD_MIN_LENGTH && value.length <= PASSWORD_MAX_LENGTH;
}

export interface ProfileFormValidation {
  nameValid: boolean;
  termsValid: boolean;
  /** Empty is fine (a username is optional); otherwise the database rule. */
  usernameValid: boolean;
  valid: boolean;
}

/** Same rule as the database: trimmed name 2..40 characters; the terms
 * checkbox is required, the research checkbox is not; a username, when given,
 * is 3..24 letters, digits, dots or underscores. */
export function validateProfileForm(input: {
  displayName: string;
  termsAccepted: boolean;
  username?: string;
}): ProfileFormValidation {
  const length = input.displayName.trim().length;
  const nameValid = length >= DISPLAY_NAME_MIN && length <= DISPLAY_NAME_MAX;
  const termsValid = input.termsAccepted;
  const typed = (input.username ?? "").trim();
  const usernameValid = typed === "" || isValidUsername(typed);
  return {
    nameValid,
    termsValid,
    usernameValid,
    valid: nameValid && termsValid && usernameValid,
  };
}

/** First problem with the create-account form, or null. The address cannot be
 * verified by mail yet, so it is typed twice; order matches the field order. */
export function validateCreateAccount(input: {
  email: string;
  emailAgain: string;
  password: string;
}): AccountErrorCode | null {
  if (!isPlausibleEmail(input.email)) {
    return "invalid_email";
  }
  if (input.email.trim().toLowerCase() !== input.emailAgain.trim().toLowerCase()) {
    return "email_mismatch";
  }
  if (!isAcceptablePassword(input.password)) {
    return "weak_password";
  }
  return null;
}

/** First problem with the set/change-password form, or null. */
export function validateNewPassword(input: {
  password: string;
  passwordAgain: string;
}): AccountErrorCode | null {
  if (!isAcceptablePassword(input.password)) {
    return "weak_password";
  }
  if (input.password !== input.passwordAgain) {
    return "password_mismatch";
  }
  return null;
}
