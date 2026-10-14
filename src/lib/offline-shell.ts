/**
 * Web only (`offline-shell.web.ts`): the service worker that lets the web
 * app open without signal, and the check for a newer deploy when the page
 * comes back into view. iOS/Android apps are installed, so nothing to do.
 */
export function startOfflineShell(): void {}

export interface UpdateOnResumeOptions {
  /** True when a reload would not interrupt the person. */
  isSafeToReload: () => boolean;
}

/** Returns a no-op stop function; the web version registers the listeners. */
export function startUpdateOnResume(_options: UpdateOnResumeOptions): () => void {
  return () => {};
}

/** The tab roots, where a reload loses nothing. Shared with the web version. */
export function isTabRootPath(pathname: string): boolean {
  return TAB_ROOT_PATHS.has(pathname.replace(/\/+$/, "") || "/");
}

const TAB_ROOT_PATHS = new Set(["/", "/map", "/sensor", "/profile", "/settings"]);
