import * as Linking from "expo-linking";
import { Platform, Settings } from "react-native";

/**
 * Where the app opens after a restart it makes itself, and the old link it
 * must not open again.
 *
 * A language switch that flips the reading direction restarts the app's
 * JavaScript inside the same app process (`restartApp`). Expo Router then
 * starts from the last link the process opened (on iOS, expo-linking keeps
 * every opened link as its "initial" one): after switching the language in
 * Settings, the app came back on Home, or on an earthquake page opened from a
 * link long before, where the web reloads in place (parity re-check K1).
 *
 * Before such a restart the screen notes where to come back to
 * (`rememberRestartResume`) and the old link is forgotten
 * (`forgetOpenedLink`); the first address Expo Router reads after the restart
 * (`app/+native-intent.tsx`) is then the noted screen
 * (`takeRestartResume`). The note is kept in the app's iOS settings, which
 * survive the restart and can be read at once, as that hook needs; it is
 * used once and only within a minute. Android has no such store yet: it
 * restarts on Home, without the old link.
 */

const RESUME_KEY = "bumelerze.resumeAfterRestart";

/** A note older than this is from an earlier run and is ignored. */
export const RESTART_RESUME_MAX_AGE_MS = 60_000;

/** Notes the app path to open after the coming restart (iOS). */
export function rememberRestartResume(path: string, now: number = Date.now()): void {
  if (Platform.OS !== "ios") {
    return;
  }
  try {
    Settings.set({ [RESUME_KEY]: JSON.stringify({ path, at: now }) });
  } catch {
    // Without the note the restart opens Home.
  }
}

/** The noted path, once: read, removed, and only if recent and an app path. */
export function takeRestartResume(now: number = Date.now()): string | null {
  if (Platform.OS !== "ios") {
    return null;
  }
  try {
    const raw: unknown = Settings.get(RESUME_KEY);
    if (raw === undefined || raw === null) {
      return null;
    }
    Settings.set({ [RESUME_KEY]: null });
    const note: unknown = JSON.parse(String(raw));
    if (typeof note !== "object" || note === null) {
      return null;
    }
    const { path, at } = note as { path?: unknown; at?: unknown };
    if (
      typeof path !== "string" ||
      !path.startsWith("/") ||
      typeof at !== "number" ||
      now < at ||
      now - at > RESTART_RESUME_MAX_AGE_MS
    ) {
      return null;
    }
    return path;
  } catch {
    return null;
  }
}

/** iOS/Android: the next restart does not open the last opened link again. */
export function forgetOpenedLink(): void {
  if (Platform.OS === "web") {
    return;
  }
  try {
    Linking.clearInitialURL();
  } catch {
    // Older builds without it: the link may open again, as before.
  }
}
