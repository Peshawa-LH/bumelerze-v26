/**
 * `src/lib/supabase.ts` — no real network call anywhere in this file
 * (Supabase-ready wiring wave brief: "no real network calls in tests").
 * `@supabase/supabase-js` is mocked entirely; `jest.resetModules()` between
 * tests (same discipline as `features/felt/__tests__/queue.test.ts`) so
 * each test gets a fresh module-scope cache (`cachedClient`,
 * `anonymousSignInPromise`) AND a fresh mock client/auth pair from the
 * mocked SDK factory below.
 */

const ORIGINAL_ENV = { ...process.env };

interface MockAuth {
  getSession: jest.Mock;
  signInAnonymously: jest.Mock;
}

interface MockSupabaseClient {
  auth: MockAuth;
  from: jest.Mock;
}

jest.mock("@supabase/supabase-js", () => {
  const auth: MockAuth = {
    getSession: jest.fn(async () => ({ data: { session: null } })),
    signInAnonymously: jest.fn(async () => ({ data: {}, error: null })),
  };
  const client: MockSupabaseClient = { auth, from: jest.fn() };
  const createClient = jest.fn(() => client);
  return { createClient, __mockClient: client };
});

function loadLib(): typeof import("../supabase") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- must be required fresh after resetModules, inside each test
  return require("../supabase");
}

function loadMockedSdk(): {
  createClient: jest.Mock;
  __mockClient: MockSupabaseClient;
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see loadLib
  return require("@supabase/supabase-js");
}

function setEnv(url: string | undefined, anonKey: string | undefined): void {
  if (url === undefined) {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  } else {
    process.env.EXPO_PUBLIC_SUPABASE_URL = url;
  }
  if (anonKey === undefined) {
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  } else {
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = anonKey;
  }
}

beforeEach(() => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("isSupabaseConfigured", () => {
  it("is false when neither env var is set", () => {
    setEnv(undefined, undefined);
    expect(loadLib().isSupabaseConfigured()).toBe(false);
  });

  it("is false when only the URL is set", () => {
    setEnv("https://example.supabase.co", undefined);
    expect(loadLib().isSupabaseConfigured()).toBe(false);
  });

  it("is false when only the anon key is set", () => {
    setEnv(undefined, "anon-key-value");
    expect(loadLib().isSupabaseConfigured()).toBe(false);
  });

  it("is false when a value is present but blank", () => {
    setEnv("   ", "anon-key-value");
    expect(loadLib().isSupabaseConfigured()).toBe(false);
  });

  it("is true once both are set", () => {
    setEnv("https://example.supabase.co", "anon-key-value");
    expect(loadLib().isSupabaseConfigured()).toBe(true);
  });
});

describe("getSupabaseClient", () => {
  it("returns null and never calls createClient when unconfigured", () => {
    setEnv(undefined, undefined);
    const lib = loadLib();
    const sdk = loadMockedSdk();

    expect(lib.getSupabaseClient()).toBeNull();
    expect(sdk.createClient).not.toHaveBeenCalled();
  });

  it("creates and memoizes a single client once configured", () => {
    setEnv("https://example.supabase.co", "anon-key-value");
    const lib = loadLib();
    const sdk = loadMockedSdk();

    const first = lib.getSupabaseClient();
    const second = lib.getSupabaseClient();

    expect(first).toBe(second);
    expect(sdk.createClient).toHaveBeenCalledTimes(1);
    expect(sdk.createClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "anon-key-value",
      expect.objectContaining({
        auth: expect.objectContaining({ persistSession: true }),
      }),
    );
  });
});

describe("signInAnonymously", () => {
  it("throws without calling the SDK when unconfigured", async () => {
    setEnv(undefined, undefined);
    const lib = loadLib();

    await expect(lib.signInAnonymously()).rejects.toThrow(/not configured/);
  });

  it("calls auth.signInAnonymously exactly once across two concurrent/serial callers", async () => {
    setEnv("https://example.supabase.co", "anon-key-value");
    const lib = loadLib();
    const sdk = loadMockedSdk();

    await Promise.all([lib.signInAnonymously(), lib.signInAnonymously()]);
    await lib.signInAnonymously();

    expect(sdk.__mockClient.auth.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(sdk.__mockClient.auth.getSession).toHaveBeenCalled();
  });

  it("skips the network call entirely when a session is already persisted", async () => {
    setEnv("https://example.supabase.co", "anon-key-value");
    const lib = loadLib();
    const sdk = loadMockedSdk();
    sdk.__mockClient.auth.getSession.mockResolvedValueOnce({
      data: { session: { access_token: "persisted" } },
    });

    await lib.signInAnonymously();

    expect(sdk.__mockClient.auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it("clears its cache on failure so a later call can retry", async () => {
    setEnv("https://example.supabase.co", "anon-key-value");
    const lib = loadLib();
    const sdk = loadMockedSdk();
    sdk.__mockClient.auth.signInAnonymously
      .mockResolvedValueOnce({ data: {}, error: { message: "network blip" } })
      .mockResolvedValueOnce({ data: {}, error: null });

    await expect(lib.signInAnonymously()).rejects.toBeTruthy();
    await expect(lib.signInAnonymously()).resolves.toBeUndefined();

    expect(sdk.__mockClient.auth.signInAnonymously).toHaveBeenCalledTimes(2);
  });
});
