/**
 * `src/lib/supabase.ts` — no real network call anywhere in this file
 * (Supabase-ready wiring brief: "no real network calls in tests").
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
  startAutoRefresh: jest.Mock;
  stopAutoRefresh: jest.Mock;
}

interface MockSupabaseClient {
  auth: MockAuth;
  from: jest.Mock;
}

jest.mock("@supabase/supabase-js", () => {
  const auth: MockAuth = {
    getSession: jest.fn(async () => ({ data: { session: null } })),
    signInAnonymously: jest.fn(async () => ({ data: {}, error: null })),
    startAutoRefresh: jest.fn(async () => undefined),
    stopAutoRefresh: jest.fn(async () => undefined),
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

describe("getSupabaseClient in a review-safe (read-only) build", () => {
  it("passes no fetch of its own when the flag is off, so supabase-js uses the global fetch", () => {
    setEnv("https://example.supabase.co", "anon-key-value");
    delete process.env.EXPO_PUBLIC_REVIEW_READONLY;
    const lib = loadLib();
    const sdk = loadMockedSdk();

    lib.getSupabaseClient();

    const options = sdk.createClient.mock.calls[0][2] as Record<string, unknown>;
    expect(options).not.toHaveProperty("global");
  });

  it("hands supabase-js a fetch that refuses writes and auth calls when EXPO_PUBLIC_REVIEW_READONLY=1", async () => {
    setEnv("https://example.supabase.co", "anon-key-value");
    process.env.EXPO_PUBLIC_REVIEW_READONLY = "1";
    const lib = loadLib();
    const sdk = loadMockedSdk();
    const realFetch = jest.fn(async () => new Response("[]", { status: 200 }));
    const originalFetch = global.fetch;
    global.fetch = realFetch as unknown as typeof fetch;

    try {
      lib.getSupabaseClient();
      const options = sdk.createClient.mock.calls[0][2] as {
        global?: { fetch?: typeof fetch };
      };
      const guardedFetch = options.global?.fetch;
      expect(guardedFetch).toBeDefined();
      if (!guardedFetch) {
        return;
      }

      await guardedFetch("https://example.supabase.co/rest/v1/events?select=*");
      expect(realFetch).toHaveBeenCalledTimes(1);

      await expect(
        guardedFetch("https://example.supabase.co/rest/v1/felt_reports", {
          method: "POST",
        }),
      ).rejects.toThrow("Network request failed");
      await expect(
        guardedFetch("https://example.supabase.co/auth/v1/signup", { method: "POST" }),
      ).rejects.toThrow("Network request failed");
      expect(realFetch).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe("token refresh on iOS/Android follows the app's foreground", () => {
  // Required fresh after resetModules, like the module under test, so both
  // see the same react-native mocks.
  function loadReactNative(): {
    AppState: { addEventListener: jest.Mock };
    Platform: { OS: string };
  } {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- see loadLib
    return require("react-native");
  }

  it("restarts the token refresh when the app returns to the foreground and stops it when it leaves", () => {
    setEnv("https://example.supabase.co", "anon-key-value");
    const { AppState } = loadReactNative();
    const lib = loadLib();
    const sdk = loadMockedSdk();
    const { startAutoRefresh, stopAutoRefresh } = sdk.__mockClient.auth;

    lib.getSupabaseClient();
    lib.getSupabaseClient();

    // One listener per app, however often the client is asked for.
    expect(AppState.addEventListener).toHaveBeenCalledTimes(1);
    const [eventName, onChange] = AppState.addEventListener.mock.calls[0] as [
      string,
      (state: string) => void,
    ];
    expect(eventName).toBe("change");

    onChange("background");
    expect(stopAutoRefresh).toHaveBeenCalledTimes(1);
    expect(startAutoRefresh).not.toHaveBeenCalled();

    onChange("active");
    expect(startAutoRefresh).toHaveBeenCalledTimes(1);

    onChange("inactive");
    expect(stopAutoRefresh).toHaveBeenCalledTimes(2);
  });

  it("adds no listener when Supabase is not configured", () => {
    setEnv(undefined, undefined);
    const { AppState } = loadReactNative();
    loadLib().getSupabaseClient();
    expect(AppState.addEventListener).not.toHaveBeenCalled();
  });

  it("leaves the web alone: a browser tab refreshes the token by itself", () => {
    setEnv("https://example.supabase.co", "anon-key-value");
    const { AppState, Platform } = loadReactNative();
    const originalOS = Platform.OS;
    Platform.OS = "web";
    try {
      loadLib().getSupabaseClient();
      expect(AppState.addEventListener).not.toHaveBeenCalled();
    } finally {
      Platform.OS = originalOS;
    }
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
