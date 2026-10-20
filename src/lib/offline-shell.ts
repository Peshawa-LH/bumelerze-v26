import {
  startNativeUpdateOnResume,
  type UpdateOnResumeOptions,
} from "./native-update-on-resume";

export type { UpdateOnResumeOptions };

/**
 * Web only (`offline-shell.web.ts`): the service worker that lets the web
 * app open without signal. iOS/Android apps are installed, so nothing to do.
 */
export function startOfflineShell(): void {}

/**
 * iOS/Android: the web's "newer version on resume" check, through EAS
 * Update (`native-update-on-resume.ts`, same `isSafeToReload` rule). A
 * no-op in development builds and while the build has no update URL (until
 * the Expo project exists). Returns the function that stops it.
 */
export function startUpdateOnResume(options: UpdateOnResumeOptions): () => void {
  return startNativeUpdateOnResume(options);
}

/** The tab roots, where a reload loses nothing. Shared with the web version. */
export function isTabRootPath(pathname: string): boolean {
  return TAB_ROOT_PATHS.has(pathname.replace(/\/+$/, "") || "/");
}

const TAB_ROOT_PATHS = new Set(["/", "/map", "/sensor", "/profile", "/settings"]);
