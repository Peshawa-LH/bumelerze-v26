import { onlineManager } from "@tanstack/react-query";
import * as Updates from "expo-updates";
import { AppState, type AppStateStatus } from "react-native";

import { forgetOpenedLink } from "@/i18n/restart-resume";

/**
 * iOS/Android, update on resume: the installed app's half of the web's
 * "newer deploy on resume" check (`offline-shell.web.ts`), through EAS Update.
 *
 * An app stays in memory for days and would only run a fix after a full
 * close. When it comes back to the foreground, and at most once every five
 * minutes (the web's interval), it asks the update server for a newer
 * update of its channel, downloads it, and restarts into it, but only when
 * that costs the person nothing: the caller's `isSafeToReload` (a tab root,
 * nothing being sent; the same rule as the web). Otherwise the restart
 * waits for the next time the app comes back, without asking the server
 * again. Never mid-form.
 *
 * A launch never waits for the server either (app.config.ts,
 * `fallbackToCacheTimeout: 0`): expo-updates' own launch check downloads in
 * the background, and the update applies here or at the next launch.
 *
 * No-op while expo-updates is switched off: development builds, and every
 * build until the Expo project id exists (no update URL; app.config.ts).
 */
export const NATIVE_UPDATE_CHECK_MIN_INTERVAL_MS = 5 * 60_000;

export interface UpdateOnResumeOptions {
  /** True when a restart would not interrupt the person. Asked right before
   * restarting (and again on every later resume while an update waits). */
  isSafeToReload: () => boolean;
}

/** What one resume did; for tests and debugging. */
export type NativeUpdateOutcome =
  "skipped" | "current" | "failed" | "deferred" | "reloaded";

/** The expo-updates and app-state pieces the check uses; tests hand in fakes. */
export interface NativeUpdateEnvironment {
  /** expo-updates is on: a release build with an update URL. */
  isEnabled: boolean;
  /** Asks the update server whether there is something newer to run
   * (a new update, or a roll back to the update built into the app). */
  checkForUpdate: () => Promise<boolean>;
  /** Downloads it; true when there is something new to restart into. */
  fetchUpdate: () => Promise<boolean>;
  /** Restarts the app's JavaScript into the downloaded update. */
  reload: () => Promise<void>;
  isOnline: () => boolean;
  now: () => number;
  /** Calls `listener` each time the app comes back to the foreground;
   * returns the function that stops listening. */
  onForeground: (listener: () => void) => () => void;
}

/**
 * The checker itself, without any listener: `check()` runs one resume.
 * `startNativeUpdateOnResume` wires it to the app's foreground changes.
 */
export function createNativeUpdateOnResume(
  options: UpdateOnResumeOptions,
  env: NativeUpdateEnvironment,
) {
  // expo-updates checked at launch: the first check here waits a full
  // interval, as on the web.
  let lastCheckAt = env.now();
  // Downloaded, but the moment was not right; restart on the next resume
  // that is.
  let pending = false;
  let checking: Promise<NativeUpdateOutcome> | null = null;

  async function run(): Promise<NativeUpdateOutcome> {
    if (!env.isEnabled) {
      return "skipped";
    }
    if (!pending) {
      const now = env.now();
      if (now - lastCheckAt < NATIVE_UPDATE_CHECK_MIN_INTERVAL_MS || !env.isOnline()) {
        return "skipped";
      }
      lastCheckAt = now;
      try {
        if (!(await env.checkForUpdate()) || !(await env.fetchUpdate())) {
          return "current";
        }
      } catch {
        // No server, a weak connection or a failed download: the app keeps
        // running the version it has, and a later resume asks again.
        return "failed";
      }
      pending = true;
    }
    if (!options.isSafeToReload()) {
      return "deferred";
    }
    try {
      await env.reload();
    } catch {
      // The restart was refused: the downloaded update still applies at the
      // next launch, and the next resume tries again.
      return "failed";
    }
    return "reloaded";
  }

  return {
    /** One resume. Concurrent calls share one run. */
    check(): Promise<NativeUpdateOutcome> {
      if (!checking) {
        checking = run().finally(() => {
          checking = null;
        });
      }
      return checking;
    },
    /** A downloaded update is waiting for a safe moment; for tests and debugging. */
    hasPendingUpdate(): boolean {
      return pending;
    },
  };
}

/** The real expo-updates and React Native app state as a `NativeUpdateEnvironment`. */
export function expoUpdatesEnvironment(): NativeUpdateEnvironment {
  return {
    isEnabled: Updates.isEnabled && !__DEV__,
    checkForUpdate: async () => {
      const result = await Updates.checkForUpdateAsync();
      return result.isAvailable || result.isRollBackToEmbedded;
    },
    fetchUpdate: async () => {
      const result = await Updates.fetchUpdateAsync();
      return result.isNew || result.isRollBackToEmbedded;
    },
    reload: () => {
      // Restarted at a tab root: not on the last link the app opened.
      forgetOpenedLink();
      return Updates.reloadAsync();
    },
    // The connection as React Query sees it.
    isOnline: () => onlineManager.isOnline(),
    now: () => Date.now(),
    onForeground: (listener) => {
      let previous: AppStateStatus = AppState.currentState;
      const subscription = AppState.addEventListener("change", (next) => {
        const cameBack = previous !== "active" && next === "active";
        previous = next;
        if (cameBack) {
          listener();
        }
      });
      return () => subscription.remove();
    },
  };
}

/**
 * Wires the check to the app: every time it comes back to the foreground.
 * Returns the function that stops listening again.
 */
export function startNativeUpdateOnResume(
  options: UpdateOnResumeOptions,
  env: NativeUpdateEnvironment = expoUpdatesEnvironment(),
): () => void {
  if (!env.isEnabled) {
    return () => {};
  }
  const checker = createNativeUpdateOnResume(options, env);
  return env.onForeground(() => {
    void checker.check();
  });
}
