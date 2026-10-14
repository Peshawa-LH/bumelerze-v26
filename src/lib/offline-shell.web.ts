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
