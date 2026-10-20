import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import { useEffect } from "react";

/**
 * iOS/Android: the first frame (the web has no native splash screen:
 * `splash.web.ts`).
 *
 * The splash screen (app.config.ts: Signal Red, Approved Navy in dark mode)
 * stays up until the first real screen can draw: settings read from the
 * phone, the language ready, the fonts registered (`app/_layout.tsx`
 * decides). Without this, the splash went away on the first JavaScript
 * frame and a blank frame followed, white in dark mode. It then fades out
 * over a fifth of a second. Panic-time rule: it never waits longer than
 * `SPLASH_MAX_HOLD_MS`, whatever happens.
 */
export const SPLASH_MAX_HOLD_MS = 4000;
const SPLASH_FADE_MS = 200;

let hidden = false;

/** Keeps the splash screen up. Called once, when `app/_layout.tsx` loads,
 * before anything renders. */
export function holdSplashScreen(): void {
  SplashScreen.setOptions({ duration: SPLASH_FADE_MS, fade: true });
  SplashScreen.preventAutoHideAsync().catch(() => {
    // No splash screen to hold (it is already gone): nothing to do.
  });
}

/** Hides the splash screen; once only. */
export function hideSplashScreen(): void {
  if (hidden) {
    return;
  }
  hidden = true;
  SplashScreen.hide();
}

/**
 * Hides the splash screen once `ready`, one frame later so the first screen
 * is drawn underneath before the fade; or after `SPLASH_MAX_HOLD_MS`.
 */
export function useSplashScreenGate(ready: boolean): void {
  useEffect(() => {
    const timer = setTimeout(hideSplashScreen, SPLASH_MAX_HOLD_MS);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!ready) {
      return;
    }
    const frame = requestAnimationFrame(hideSplashScreen);
    return () => cancelAnimationFrame(frame);
  }, [ready]);
}

/**
 * The window behind every screen takes the app's background colour
 * (Settings > Appearance included, not only the phone's setting), so a
 * screen sliding in, a modal opening or a reload never shows a white edge in
 * dark mode. iOS keeps the colour for the next launch.
 */
export function useSystemBackgroundColor(color: string): void {
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(color).catch(() => {
      // The default (white or black with the phone's setting) stays.
    });
  }, [color]);
}

/** Tests only: forget that the splash screen was hidden. */
export function resetSplashScreenForTests(): void {
  hidden = false;
}
