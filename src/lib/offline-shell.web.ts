import { SERVICE_WORKER_FILE, webBase } from "@/features/alerts/web-push";

/**
 * Lets the web app open without signal (public/push-sw.js keeps a copy of
 * the app; the earthquake list itself comes from the app's own saved feed).
 *
 * Production web builds only: the build stamps EXPO_PUBLIC_BUILD_ID, and a
 * development server never registers a caching worker.
 *
 * 1. Registers the app's one service worker (the same file and scope web
 *    push uses, so this never replaces the alert subscription). Waits until
 *    the page has loaded and two seconds more, so it does not compete with
 *    the first earthquake list on a slow connection.
 * 2. Tells the worker which of the app's files this page already loaded:
 *    on a first visit they were fetched before the worker was in control.
 * 3. Recovery: if the worker in control answers with another deploy, or
 *    does not answer (a worker from before this version), it is asked to
 *    update at once. It is never unregistered: that would also end alerts.
 */
const START_DELAY_MS = 2000;
const VERSION_TIMEOUT_MS = 3000;

interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

export function startOfflineShell(): void {
  const build = process.env.EXPO_PUBLIC_BUILD_ID;
  if (
    __DEV__ ||
    !build ||
    typeof window === "undefined" ||
    typeof navigator === "undefined" ||
    !("serviceWorker" in navigator)
  ) {
    return;
  }
  const begin = () => {
    window.setTimeout(() => {
      void run(build).catch(() => {
        // No worker (private mode, blocked): the app works as before.
      });
    }, START_DELAY_MS);
  };
  if (document.readyState === "complete") {
    begin();
  } else {
    window.addEventListener("load", begin, { once: true });
  }
}

async function run(build: string): Promise<void> {
  const base = webBase();
  const container = navigator.serviceWorker;
  const registration = await container.register(`${base}/${SERVICE_WORKER_FILE}`, {
    scope: `${base}/`,
  });
  const controller = container.controller;
  if (controller) {
    const running = await askVersion(controller);
    if (running !== build) {
      await registration.update().catch(() => undefined);
    }
  }
  const ready = await container.ready;
  ready.active?.postMessage({
    type: "bumelerze-keep",
    build,
    urls: loadedAppFiles(base),
  });
}

/** The deploy the worker in control belongs to; null if it does not say. */
function askVersion(worker: WorkerLike): Promise<string | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => resolve(null), VERSION_TIMEOUT_MS);
    channel.port1.onmessage = (event: MessageEvent<{ build?: unknown }>) => {
      window.clearTimeout(timer);
      resolve(typeof event.data?.build === "string" ? event.data.build : null);
    };
    worker.postMessage({ type: "bumelerze-version" }, [channel.port2]);
  });
}

/** Same-origin app files (scripts, styles, fonts, images) this page loaded. */
export function loadedAppFiles(base: string): string[] {
  const origin = window.location.origin;
  const prefixes = [`${origin}${base}/_expo/static/`, `${origin}${base}/assets/`];
  const names = performance
    .getEntriesByType("resource")
    .map((entry) => entry.name.split("#")[0] ?? "")
    .concat(Array.from(document.scripts, (script) => script.src));
  return Array.from(
    new Set(names.filter((name) => prefixes.some((prefix) => name.startsWith(prefix)))),
  );
}

/* ------------------------------------------------------------------------ */
/* Update on resume (incident 2026-10-14)                                     */
/* ------------------------------------------------------------------------ */

/**
 * A phone keeps the app's tab open for days; it only ever loaded the deploy
 * of its first visit and never saw a fix. When the page comes back into view
 * (the tab or the phone wakes: `visibilitychange`, `focus`), and at most
 * once every five minutes, the live page is fetched past every cache and its
 * `<meta name="bumelerze-build">` compared with the build this page runs.
 * A different build means a newer deploy: the service worker is asked to
 * update first (so the reload lands on the new worker and its cache), then
 * the page reloads — but only when that costs the person nothing: on a tab
 * root, with no report or check-in form open and nothing being sent (the
 * caller decides, `isSafeToReload`). Otherwise the reload waits for the next
 * time the page comes back into view, without asking the network again.
 * Never mid-form.
 */
export const UPDATE_CHECK_MIN_INTERVAL_MS = 5 * 60_000;
const SW_UPDATE_WAIT_MS = 3000;

export interface UpdateOnResumeOptions {
  /** True when a reload would not interrupt the person. Asked right before
   * reloading (and again on every later resume while an update waits). */
  isSafeToReload: () => boolean;
}

/** The browser pieces the check uses; tests hand in fakes. */
export interface UpdateEnvironment {
  /** The build this page runs (EXPO_PUBLIC_BUILD_ID); undefined in development. */
  build: string | undefined;
  isDevelopment: boolean;
  /** Fetches the live page's HTML past every cache; null when it cannot. */
  fetchLivePage: () => Promise<string | null>;
  /** Asks the registered service worker to look for a new version. */
  updateServiceWorker: () => Promise<void>;
  isOnline: () => boolean;
  reload: () => void;
  now: () => number;
  addListener: (type: "visibilitychange" | "focus", listener: () => void) => () => void;
  isVisible: () => boolean;
}

export type UpdateCheckOutcome = "skipped" | "current" | "deferred" | "reloaded";

/** The deploy a page belongs to (scripts/build-app-web.sh stamps the tag). */
export function liveBuildId(html: string): string | null {
  const match = /<meta name="bumelerze-build" content="([^"]*)"/.exec(html);
  return match ? match[1] ?? null : null;
}

export function isTabRootPath(pathname: string): boolean {
  return TAB_ROOT_PATHS.has(pathname.replace(/\/+$/, "") || "/");
}

const TAB_ROOT_PATHS = new Set(["/", "/map", "/sensor", "/profile", "/settings"]);

/**
 * The checker itself, without any listener: `check()` runs one resume.
 * `startUpdateOnResume` wires it to the page's events.
 */
export function createUpdateOnResume(options: UpdateOnResumeOptions, env: UpdateEnvironment) {
  // The page just loaded this build: the first look at the server waits a
  // full interval.
  let lastCheckAt = env.now();
  // A newer deploy was seen but the moment was not right; reload on the
  // next resume that is.
  let pendingBuild: string | null = null;
  let checking: Promise<UpdateCheckOutcome> | null = null;

  async function run(): Promise<UpdateCheckOutcome> {
    if (!env.build || env.isDevelopment) {
      return "skipped";
    }
    if (!pendingBuild) {
      const now = env.now();
      if (now - lastCheckAt < UPDATE_CHECK_MIN_INTERVAL_MS || !env.isOnline()) {
        return "skipped";
      }
      lastCheckAt = now;
      const html = await env.fetchLivePage();
      if (html === null) {
        return "skipped";
      }
      const live = liveBuildId(html);
      if (!live || live === env.build) {
        return "current";
      }
      pendingBuild = live;
      // The new worker first (it skips waiting and claims the page), so the
      // reload is served by it; a worker that does not answer must not
      // hold the update back.
      await Promise.race([
        env.updateServiceWorker().catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, SW_UPDATE_WAIT_MS)),
      ]);
    }
    if (!options.isSafeToReload()) {
      return "deferred";
    }
    env.reload();
    return "reloaded";
  }

  return {
    /** One resume. Concurrent calls share one run. */
    check(): Promise<UpdateCheckOutcome> {
      if (!checking) {
        checking = run().finally(() => {
          checking = null;
        });
      }
      return checking;
    },
    /** The newer build seen and not yet reloaded to, for tests and debugging. */
    pendingBuild(): string | null {
      return pendingBuild;
    },
  };
}

/** The real browser as an `UpdateEnvironment`; null outside one. */
export function browserUpdateEnvironment(): UpdateEnvironment | null {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    typeof navigator === "undefined" ||
    typeof fetch !== "function"
  ) {
    return null;
  }
  const base = webBase();
  return {
    build: process.env.EXPO_PUBLIC_BUILD_ID,
    isDevelopment: __DEV__,
    fetchLivePage: async () => {
      try {
        const response = await fetch(`${base}/`, {
          cache: "no-store",
          credentials: "same-origin",
          headers: { accept: "text/html" },
        });
        return response.ok ? await response.text() : null;
      } catch {
        return null;
      }
    },
    updateServiceWorker: async () => {
      const registration = await navigator.serviceWorker?.getRegistration(`${base}/`);
      await registration?.update();
    },
    isOnline: () => navigator.onLine !== false,
    reload: () => window.location.reload(),
    now: () => Date.now(),
    addListener: (type, listener) => {
      const target: EventTarget = type === "focus" ? window : document;
      target.addEventListener(type, listener);
      return () => target.removeEventListener(type, listener);
    },
    isVisible: () => document.visibilityState !== "hidden",
  };
}

/**
 * Wires the check to the page: every time it becomes visible or focused.
 * Returns the function that removes the listeners again.
 */
export function startUpdateOnResume(
  options: UpdateOnResumeOptions,
  env: UpdateEnvironment | null = browserUpdateEnvironment(),
): () => void {
  if (!env || !env.build || env.isDevelopment) {
    return () => {};
  }
  const checker = createUpdateOnResume(options, env);
  const onResume = () => {
    if (env.isVisible()) {
      void checker.check();
    }
  };
  const stops = [env.addListener("visibilitychange", onResume), env.addListener("focus", onResume)];
  return () => {
    for (const stop of stops) stop();
  };
}
