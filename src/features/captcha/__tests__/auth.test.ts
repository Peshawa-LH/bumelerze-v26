import type { SupabaseClient } from "@supabase/supabase-js";
import { TURNSTILE_TEST_SITE_KEYS } from "../test-keys";

import {
  captchaOptions,
  signInAnonymouslyWithCaptcha,
  signInWithPasswordWithCaptcha,
} from "../auth";
import {
  __resetCaptchaForTests,
  failCaptchaRequest,
  resolveCaptchaRequest,
  useCaptchaStore,
} from "../token-broker";

/**
 * The protected Supabase Auth calls (A1.4): with a site key, each carries
 * `options.captchaToken`; without one — or when Turnstile cannot produce a
 * token — the call is byte-for-byte the old one.
 */

const ORIGINAL_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY;

function makeClient() {
  return {
    auth: {
      signInAnonymously: jest.fn(async (..._args: unknown[]) => ({
        data: { user: null, session: null },
        error: null,
      })),
      signInWithPassword: jest.fn(async (..._args: unknown[]) => ({
        data: { user: null, session: null },
        error: null,
      })),
    },
  };
}

function asClient(client: ReturnType<typeof makeClient>): SupabaseClient {
  return client as unknown as SupabaseClient;
}

/** A stand-in host: answers every request the moment it appears. */
function answerEveryRequestWith(next: () => string | null): () => void {
  return useCaptchaStore.subscribe((state) => {
    const request = state.active;
    if (!request) {
      return;
    }
    const token = next();
    if (token) {
      resolveCaptchaRequest(request.id, token);
    } else {
      failCaptchaRequest(request.id);
    }
  });
}

let stopHost: (() => void) | null = null;

beforeEach(() => {
  __resetCaptchaForTests();
});

afterEach(() => {
  stopHost?.();
  stopHost = null;
  __resetCaptchaForTests();
  if (ORIGINAL_KEY === undefined) {
    delete process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY;
  } else {
    process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY = ORIGINAL_KEY;
  }
});

describe("without a site key", () => {
  beforeEach(() => {
    delete process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY;
  });

  it("captchaOptions is null", async () => {
    await expect(captchaOptions()).resolves.toBeNull();
  });

  it("anonymous sign-in is the old call, with no argument at all", async () => {
    const client = makeClient();
    await signInAnonymouslyWithCaptcha(asClient(client));
    expect(client.auth.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(client.auth.signInAnonymously.mock.calls[0]).toEqual([]);
  });

  it("password sign-in sends only email and password", async () => {
    const client = makeClient();
    await signInWithPasswordWithCaptcha(asClient(client), {
      email: "a@b.co",
      password: "secret-1",
    });
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "a@b.co",
      password: "secret-1",
    });
  });
});

describe("with a site key", () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY = TURNSTILE_TEST_SITE_KEYS.passInvisible;
  });

  it("anonymous sign-in carries a fresh token, a new one on every call", async () => {
    let n = 0;
    stopHost = answerEveryRequestWith(() => `token-${++n}`);
    const client = makeClient();
    await signInAnonymouslyWithCaptcha(asClient(client));
    await signInAnonymouslyWithCaptcha(asClient(client));
    expect(client.auth.signInAnonymously.mock.calls).toEqual([
      [{ options: { captchaToken: "token-1" } }],
      [{ options: { captchaToken: "token-2" } }],
    ]);
  });

  it("password sign-in carries the token next to the credentials", async () => {
    stopHost = answerEveryRequestWith(() => "token-x");
    const client = makeClient();
    await signInWithPasswordWithCaptcha(asClient(client), {
      email: "a@b.co",
      password: "secret-1",
    });
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "a@b.co",
      password: "secret-1",
      options: { captchaToken: "token-x" },
    });
  });

  it("Turnstile fails: the call still goes out, without a token (works while CAPTCHA is off)", async () => {
    stopHost = answerEveryRequestWith(() => null);
    const client = makeClient();
    await signInAnonymouslyWithCaptcha(asClient(client));
    expect(client.auth.signInAnonymously.mock.calls[0]).toEqual([]);
  });
});
