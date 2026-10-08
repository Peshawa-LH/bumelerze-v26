import { EVENT_POST_MAX_LENGTH, POST_MAX_LENGTH } from "./constants";

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

/** The text of an earthquake shared to a profile: optional, at most 280. */
export function validateEventPostText(text: string): PostBodyProblem | null {
  return text.trim().length > EVENT_POST_MAX_LENGTH ? "too_long" : null;
}

/** The rule for an edit, which depends on the kind of post. */
export function validatePostEdit(
  text: string,
  kind: "text" | "event",
): PostBodyProblem | null {
  return kind === "event" ? validateEventPostText(text) : validatePostBody(text);
}
