import { POST_MAX_LENGTH } from "./constants";

export type PostBodyProblem = "empty" | "too_long";

/** Client-side mirror of the server rule: 1 to 500 characters after trimming
 * (the server trims too). Returns the problem, or null when the text can be
 * posted. */
export function validatePostBody(text: string): PostBodyProblem | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return "empty";
  }
  if (trimmed.length > POST_MAX_LENGTH) {
    return "too_long";
  }
  return null;
}
