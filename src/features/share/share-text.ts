import * as Clipboard from "expo-clipboard";
import { Platform, Share } from "react-native";

/** What a text/link share ended up doing, so the sheet can say so. */
export type TextShareOutcome = "shared" | "copied" | "cancelled" | "failed";

/** The browser's "user closed the share dialog" rejection is not an error. */
export function isShareAbort(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/** Copies text to the clipboard. `false` when the platform refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    return await Clipboard.setStringAsync(text);
  } catch {
    return false;
  }
}

/**
 * Shares plain text (the caption, which carries the event link) through the
 * platform's own share sheet: `Share.share` on the phone, `navigator.share`
 * on the web. Where the web has no share sheet (most desktop browsers) the
 * text is copied instead, and the outcome says "copied" so the caller can
 * show "Link copied".
 */
export async function shareText(text: string, title: string): Promise<TextShareOutcome> {
  if (Platform.OS === "web") {
    const nav = typeof navigator === "undefined" ? undefined : navigator;
    if (nav && typeof nav.share === "function") {
      try {
        await nav.share({ text, title });
        return "shared";
      } catch (error) {
        if (isShareAbort(error)) {
          return "cancelled";
        }
        // Any other failure: fall through to the clipboard.
      }
    }
    return (await copyText(text)) ? "copied" : "failed";
  }
  try {
    const result = await Share.share({ message: text, title });
    return result.action === Share.dismissedAction ? "cancelled" : "shared";
  } catch {
    return "failed";
  }
}
