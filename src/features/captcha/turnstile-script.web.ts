import { TURNSTILE_SCRIPT_URL } from "./config";

/**
 * Web: loads Cloudflare's Turnstile script on demand — only when a protected
 * auth call actually needs a token (a first anonymous sign-in, a password
 * sign-in), never with the first page, so the first load and the offline
 * copy (public/push-sw.js keeps only this site's own files) are untouched.
 * Loaded straight from challenges.cloudflare.com, as Cloudflare requires
 * (no proxy, no cached copy). A failed load is forgotten, so the next call
 * tries again.
 */

/** The part of `window.turnstile` the app uses. */
export interface TurnstileApi {
  render(
    container: HTMLElement,
    params: Record<string, unknown>,
  ): string | null | undefined;
  remove(widgetId: string): void;
}

interface ScriptElementLike {
  src: string;
  async: boolean;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  remove(): void;
}

/** What the loader needs from the page; tests pass a fake. */
export interface TurnstileScriptEnvironment {
  getApi(): TurnstileApi | null;
  createScript(): ScriptElementLike;
  appendScript(script: ScriptElementLike): void;
}

function isTurnstileApi(value: unknown): value is TurnstileApi {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { render?: unknown }).render === "function" &&
    typeof (value as { remove?: unknown }).remove === "function"
  );
}

function browserEnvironment(): TurnstileScriptEnvironment {
  return {
    getApi: () => {
      const candidate =
        typeof window === "undefined"
          ? undefined
          : (window as unknown as { turnstile?: unknown }).turnstile;
      return isTurnstileApi(candidate) ? candidate : null;
    },
    createScript: () => document.createElement("script") as unknown as ScriptElementLike,
    appendScript: (script) => {
      document.head.appendChild(script as unknown as HTMLScriptElement);
    },
  };
}

let pending: Promise<TurnstileApi> | null = null;

export function loadTurnstileScript(
  environment: TurnstileScriptEnvironment = browserEnvironment(),
): Promise<TurnstileApi> {
  const ready = environment.getApi();
  if (ready) {
    return Promise.resolve(ready);
  }
  if (pending) {
    return pending;
  }
  const attempt = new Promise<TurnstileApi>((resolve, reject) => {
    const script = environment.createScript();
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      const api = environment.getApi();
      if (api) {
        resolve(api);
      } else {
        script.remove();
        reject(new Error("turnstile: script loaded without its API"));
      }
    };
    script.onerror = () => {
      script.remove();
      reject(new Error("turnstile: script failed to load"));
    };
    environment.appendScript(script);
  });
  pending = attempt;
  attempt.catch(() => {
    if (pending === attempt) {
      pending = null;
    }
  });
  return attempt;
}

/** Test-only: forget the cached load. */
export function __resetTurnstileScriptForTests(): void {
  pending = null;
}
