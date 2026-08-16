/**
 * Web-only self-heal for the SPA deploy trap (found live 2026-08-16, map
 * wave deploy): a browser holding a pre-deploy page in cache requests that
 * build's content-hashed lazy chunks, which no longer exist after the next
 * deploy — Netlify's SPA fallback masks the 404 as HTML, the module loader
 * throws ("non-JavaScript MIME type" / "Failed to fetch dynamically
 * imported module"), and the affected screen hangs forever. netlify.toml's
 * no-cache rule on app HTML prevents the *common* path; this guard covers
 * every remaining variant (memory/bfcache, mid-session deploys) by hard
 * reloading ONCE per session when a chunk-load failure is detected —
 * a reload fetches the fresh HTML + matching chunks and recovers.
 *
 * Native: never installed (no dynamic web chunks exist there).
 */

const RELOAD_GUARD_KEY = "bumelerze.chunk-reload";

const CHUNK_ERROR_PATTERN =
  /module script|dynamically imported module|ChunkLoadError|Importing a module script failed/i;

interface GuardWindow {
  addEventListener: Window["addEventListener"];
  sessionStorage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  location: { reload: () => void };
}

/** Exported for tests; production installs on the real window below. */
export function installChunkReloadGuard(win: GuardWindow): void {
  const reloadOnce = (): void => {
    try {
      if (win.sessionStorage.getItem(RELOAD_GUARD_KEY)) {
        // Already reloaded once this session — don't loop; the screen-level
        // offline/error states take it from here.
        return;
      }
      win.sessionStorage.setItem(RELOAD_GUARD_KEY, "1");
    } catch {
      // sessionStorage unavailable (privacy mode) — reloading without the
      // guard risks a loop, so do nothing.
      return;
    }
    win.location.reload();
  };

  win.addEventListener(
    "error",
    (event) => {
      const message =
        (event as ErrorEvent).message ??
        ((event as Event).target as { src?: string } | null)?.src ??
        "";
      if (typeof message === "string" && CHUNK_ERROR_PATTERN.test(message)) {
        reloadOnce();
      }
    },
    true,
  );

  win.addEventListener("unhandledrejection", (event) => {
    const reason = (event as PromiseRejectionEvent).reason as
      | { message?: string }
      | undefined;
    if (reason?.message && CHUNK_ERROR_PATTERN.test(reason.message)) {
      reloadOnce();
    }
  });

  // A fully successful load means this session runs the current deploy —
  // clear the guard so a FUTURE mid-session deploy can also self-heal.
  win.addEventListener("load", () => {
    try {
      win.sessionStorage.removeItem(RELOAD_GUARD_KEY);
    } catch {
      // Ignore — same privacy-mode case as above.
    }
  });
}

// Self-install on real web only. The extra addEventListener check matters:
// jest-expo's native test environment polyfills a bare `window` object
// without DOM event APIs, and native runtimes similarly expose partial
// globals — this must be a no-op everywhere except an actual browser.
if (
  typeof window !== "undefined" &&
  typeof window.addEventListener === "function" &&
  typeof sessionStorage !== "undefined"
) {
  installChunkReloadGuard(window as unknown as GuardWindow);
}
