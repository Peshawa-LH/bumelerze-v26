/**
 * Web: the browser lays text out again when a web font arrives, so the
 * Vazirmatn family can be named before the file is in. Always ready. The
 * iOS/Android version (`arabic-script-face.native.ts`) waits for the faces.
 */
export function useArabicScriptFaceReady(_needed: boolean): boolean {
  return true;
}
