/**
 * `signInAnonymously()` (every guest write's session: felt reports,
 * feedback, check-ins, Event hub, alerts, people search, guidelines) and
 * the Turnstile token of A1.4. supabase-js and the token broker are mocked.
 */

const ORIGINAL_ENV = { ...process.env };

const mockGetCaptchaToken = jest.fn<Promise<string | null>, []>();
jest.mock("@/features/captcha/token-broker", () => ({
  getCaptchaToken: () => mockGetCaptchaToken(),
}));

jest.mock("@supabase/supabase-js", () => {
  const auth = {
    getSession: jest.fn(async () => ({ data: { session: null } })),
    signInAnonymously: jest.fn(async (..._args: unknown[]) => ({
      data: {},
      error: null,
    })),
    startAutoRefresh: jest.fn(async () => undefined),
    stopAutoRefresh: jest.fn(async () => undefined),
  };
  const client = { auth, from: jest.fn() };
  return { createClient: jest.fn(() => client), __mockClient: client };
});

type MockAuth = {
  getSession: jest.Mock;
  signInAnonymously: jest.Mock;
};

function load() {
  /* eslint-disable @typescript-eslint/no-require-imports -- fresh after resetModules */
  const lib = require("../supabase") as typeof import("../supabase");
  const sdk = require("@supabase/supabase-js") as { __mockClient: { auth: MockAuth } };
  /* eslint-enable @typescript-eslint/no-require-imports */
  return { lib, auth: sdk.__mockClient.auth };
}

beforeEach(() => {
  jest.resetModules();
  mockGetCaptchaToken.mockReset();
  process.env = {
    ...ORIGINAL_ENV,
    EXPO_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    EXPO_PUBLIC_SUPABASE_ANON_KEY: "anon-key-value",
  };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("signInAnonymously with CAPTCHA", () => {
  it("passes the Turnstile token as options.captchaToken", async () => {
    mockGetCaptchaToken.mockResolvedValueOnce("tok-anon");
    const { lib, auth } = load();
    await lib.signInAnonymously();
    expect(auth.signInAnonymously).toHaveBeenCalledWith({
      options: { captchaToken: "tok-anon" },
    });
  });

  it("no token: exactly the old call, with no argument", async () => {
    mockGetCaptchaToken.mockResolvedValueOnce(null);
    const { lib, auth } = load();
    await lib.signInAnonymously();
    expect(auth.signInAnonymously.mock.calls).toEqual([[]]);
  });

  it("a session kept on the device: no token is asked for (Turnstile never loads)", async () => {
    const { lib, auth } = load();
    auth.getSession.mockResolvedValueOnce({
      data: { session: { access_token: "kept" } },
    });
    await lib.signInAnonymously();
    expect(mockGetCaptchaToken).not.toHaveBeenCalled();
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it("callers waiting together share one sign-in and one token", async () => {
    mockGetCaptchaToken.mockResolvedValue("tok-shared");
    const { lib, auth } = load();
    await Promise.all([
      lib.signInAnonymously(),
      lib.signInAnonymously(),
      lib.signInAnonymously(),
    ]);
    expect(mockGetCaptchaToken).toHaveBeenCalledTimes(1);
    expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it("a refused sign-in (CAPTCHA on, no valid token) rejects; the next try gets a NEW token", async () => {
    mockGetCaptchaToken.mockResolvedValueOnce(null).mockResolvedValueOnce("tok-second");
    const { lib, auth } = load();
    auth.signInAnonymously
      .mockResolvedValueOnce({
        data: {},
        error: {
          code: "captcha_failed",
          status: 400,
          message: "captcha protection: request disallowed",
        },
      })
      .mockResolvedValueOnce({ data: {}, error: null });

    await expect(lib.signInAnonymously()).rejects.toMatchObject({
      code: "captcha_failed",
    });
    await expect(lib.signInAnonymously()).resolves.toBeUndefined();
    expect(mockGetCaptchaToken).toHaveBeenCalledTimes(2);
    expect(auth.signInAnonymously.mock.calls).toEqual([
      [],
      [{ options: { captchaToken: "tok-second" } }],
    ]);
  });
});
