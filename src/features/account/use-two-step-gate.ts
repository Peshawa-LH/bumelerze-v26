import { usePathname, useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { ensureAccountSync, useAccountStore } from "./store";
import { twoStepCodeNeeded } from "./two-step";

/** Screens that handle the code themselves (or are about it): never
 * interrupted by the check. */
const OWN_CODE_PATHS = [
  "/account/sign-in",
  "/account/password",
  "/account/two-step",
];

export const TWO_STEP_CODE_PATH = "/account/two-step-code";

/** How often the check asks the server for the account's factors (one
 * small request); in between it reads this device's stored session. */
export const FRESH_CHECK_EVERY_MS = 10 * 60_000;

let lastFreshCheckAt = Number.NEGATIVE_INFINITY;

function handlesCodeItself(pathname: string): boolean {
  return OWN_CODE_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`) || pathname.startsWith(`${path}-`),
  );
}

/**
 * When the app starts or comes back to the foreground signed in to an
 * account that has two-step sign-in on but has not given a code in this
 * session (a device signed in before two-step sign-in was turned on, or a
 * sign-in left at the code), open "Enter your code". Guests and accounts
 * without two-step sign-in are never interrupted, and nothing blocks the
 * app: Back leaves the code screen and the next return asks again.
 */
export function useTwoStepGate(ready: boolean): void {
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);
  const status = useAccountStore((state) => state.status);

  useEffect(() => {
    if (ready) {
      ensureAccountSync();
    }
  }, [ready]);

  useEffect(() => {
    if (!ready || status !== "account") {
      return;
    }
    let active = true;
    let checking = false;
    async function check() {
      if (checking || handlesCodeItself(pathnameRef.current)) {
        return;
      }
      checking = true;
      try {
        const now = Date.now();
        const fresh = now - lastFreshCheckAt >= FRESH_CHECK_EVERY_MS;
        if (fresh) {
          lastFreshCheckAt = now;
        }
        const needed = await twoStepCodeNeeded({ fresh });
        if (active && needed && !handlesCodeItself(pathnameRef.current)) {
          router.push(TWO_STEP_CODE_PATH);
        }
      } finally {
        checking = false;
      }
    }
    void check();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void check();
      }
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [ready, status, router]);
}

/** Test-only: forget when the server was last asked. */
export function __resetTwoStepGateForTests(): void {
  lastFreshCheckAt = Number.NEGATIVE_INFINITY;
}
