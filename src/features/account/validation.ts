import { DISPLAY_NAME_MAX, DISPLAY_NAME_MIN } from "./constants";

export interface ProfileFormValidation {
  nameValid: boolean;
  termsValid: boolean;
  valid: boolean;
}

/** Same rule as the database: trimmed name 2..40 characters; the terms
 * checkbox is required, the research checkbox is not. */
export function validateProfileForm(input: {
  displayName: string;
  termsAccepted: boolean;
}): ProfileFormValidation {
  const length = input.displayName.trim().length;
  const nameValid = length >= DISPLAY_NAME_MIN && length <= DISPLAY_NAME_MAX;
  const termsValid = input.termsAccepted;
  return { nameValid, termsValid, valid: nameValid && termsValid };
}
