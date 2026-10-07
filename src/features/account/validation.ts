import { isValidUsername } from "@/features/community/username";
import { DISPLAY_NAME_MAX, DISPLAY_NAME_MIN } from "./constants";

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
