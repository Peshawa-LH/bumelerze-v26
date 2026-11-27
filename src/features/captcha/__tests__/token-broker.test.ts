import { CAPTCHA_INTERACTIVE_TIMEOUT_MS, CAPTCHA_TOKEN_TIMEOUT_MS } from "../config";
import { TURNSTILE_TEST_SITE_KEYS } from "../test-keys";

import {
  __resetCaptchaForTests,
  failCaptchaRequest,
  getCaptchaToken,
  resolveCaptchaRequest,
  showCaptchaRequest,
  useCaptchaStore,
} from "../token-broker";

/**
 * Security item A1.4: one fresh Turnstile token per protected auth call,
 * never a throw, never a wait beyond the timeout, and nothing at all when
 * no site key is configured (the app then behaves exactly as before).
 */

const ORIGINAL_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY;
const nav = globalThis as { navigator?: { onLine?: boolean } | undefined };
const ORIGINAL_NAVIGATOR = nav.navigator;

function active() {
  return useCaptchaStore.getState().active;
}

beforeEach(() => {
  jest.useFakeTimers();
  __resetCaptchaForTests();
  process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY = TURNSTILE_TEST_SITE_KEYS.passInvisible;
});

afterEach(() => {
  __resetCaptchaForTests();
  jest.useRealTimers();
  if (ORIGINAL_KEY === undefined) {
    delete process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY;
  } else {
    process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY = ORIGINAL_KEY;
  }
  nav.navigator = ORIGINAL_NAVIGATOR;
});

describe("getCaptchaToken", () => {
  it("no site key: null at once, and nothing is drawn (today's behaviour exactly)", async () => {
    delete process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY;
    await expect(getCaptchaToken()).resolves.toBeNull();
    expect(active()).toBeNull();

    process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY = "   ";
    await expect(getCaptchaToken()).resolves.toBeNull();
    expect(active()).toBeNull();
  });

  it("a key that cannot be one (a typo, a pasted secret with spaces) counts as no key", async () => {
    process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY = "not a key!";
    await expect(getCaptchaToken()).resolves.toBeNull();
    expect(active()).toBeNull();
  });

  it("the browser is offline: null at once, the script is never asked for", async () => {
    nav.navigator = { ...(ORIGINAL_NAVIGATOR ?? {}), onLine: false };
    await expect(getCaptchaToken()).resolves.toBeNull();
    expect(active()).toBeNull();
  });

  it("asks the host for a hidden check and resolves with its token", async () => {
    const pending = getCaptchaToken();
    const request = active();
    expect(request).toEqual({
      id: expect.any(Number),
      siteKey: TURNSTILE_TEST_SITE_KEYS.passInvisible,
      mode: "hidden",
    });
    resolveCaptchaRequest(request!.id, "token-1");
    await expect(pending).resolves.toBe("token-1");
    expect(active()).toBeNull();
  });

  it("a fresh token per call: two calls are two requests, each with its own token", async () => {
    const first = getCaptchaToken();
    const second = getCaptchaToken();
    const firstId = active()!.id;
    resolveCaptchaRequest(firstId, "token-a");
    const secondId = active()!.id;
    expect(secondId).not.toBe(firstId);
    resolveCaptchaRequest(secondId, "token-b");
    await expect(first).resolves.toBe("token-a");
    await expect(second).resolves.toBe("token-b");
  });

  it("waits long enough for a slow check to pass or ask for a tap", () => {
    // Cloudflare took 23 s to ask for a tap in a flagged browser (27 Nov
    // 2026); the old 15 s wait gave up first and the sign-in was refused.
    expect(CAPTCHA_TOKEN_TIMEOUT_MS).toBeGreaterThanOrEqual(40_000);
    expect(CAPTCHA_INTERACTIVE_TIMEOUT_MS).toBeGreaterThan(CAPTCHA_TOKEN_TIMEOUT_MS);
  });

  it("times out to null (no host, a hung widget) and forgets the request", async () => {
    const pending = getCaptchaToken();
    const id = active()!.id;
    jest.advanceTimersByTime(CAPTCHA_TOKEN_TIMEOUT_MS - 1);
    expect(active()).not.toBeNull();
    jest.advanceTimersByTime(1);
    await expect(pending).resolves.toBeNull();
    expect(active()).toBeNull();
    // A late token for a request that already gave up changes nothing.
    resolveCaptchaRequest(id, "too-late");
    expect(active()).toBeNull();
  });

  it("a widget failure (blocked script, error) is null at once", async () => {
    const pending = getCaptchaToken();
    failCaptchaRequest(active()!.id);
    await expect(pending).resolves.toBeNull();
    expect(active()).toBeNull();
  });

  it("an empty token counts as no token", async () => {
    const pending = getCaptchaToken();
    resolveCaptchaRequest(active()!.id, "");
    await expect(pending).resolves.toBeNull();
  });

  it("a check that needs a tap moves to the visible sheet and gets the longer wait", async () => {
    const pending = getCaptchaToken();
    const id = active()!.id;
    jest.advanceTimersByTime(CAPTCHA_TOKEN_TIMEOUT_MS - 1000);
    showCaptchaRequest(id);
    expect(active()).toMatchObject({ id, mode: "visible" });

    // Past the invisible timeout: still waiting for the person.
    jest.advanceTimersByTime(CAPTCHA_TOKEN_TIMEOUT_MS);
    expect(active()).toMatchObject({ id, mode: "visible" });

    jest.advanceTimersByTime(CAPTCHA_INTERACTIVE_TIMEOUT_MS);
    await expect(pending).resolves.toBeNull();
    expect(active()).toBeNull();
  });

  it("'Not now' on the sheet: null, the sign-in goes ahead without a token", async () => {
    const pending = getCaptchaToken();
    const id = active()!.id;
    showCaptchaRequest(id);
    failCaptchaRequest(id);
    await expect(pending).resolves.toBeNull();
  });
});
