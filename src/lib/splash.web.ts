/**
 * Web: no native splash screen and no native window behind the page, so
 * nothing to do (`splash.ts` is the iOS/Android version). The page's own
 * colours come from `applyDocumentColorSchemeWeb`.
 */
export const SPLASH_MAX_HOLD_MS = 0;

export function holdSplashScreen(): void {}

export function hideSplashScreen(): void {}

export function useSplashScreenGate(_ready: boolean): void {}

export function useSystemBackgroundColor(_color: string): void {}

export function resetSplashScreenForTests(): void {}
