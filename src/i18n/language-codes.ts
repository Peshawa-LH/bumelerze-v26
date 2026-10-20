/**
 * A language tag from the phone ("ckb-IQ", "ar_IQ", "ku") as one of the app's
 * language codes, or null when it is not one of them. iOS and many devices
 * name Kurmanji with the generic Kurdish code "ku" (ISO 639-1); the app's
 * own code for it is "kmr" (ISO 639-3), and Sorani is always "ckb".
 */
export function appLanguageCode(tag: unknown): string | null {
  if (typeof tag !== "string" || tag.length === 0) {
    return null;
  }
  const code = tag.split(/[-_]/)[0]?.toLowerCase() ?? "";
  if (code === "ku") {
    return "kmr";
  }
  return code.length > 0 ? code : null;
}
