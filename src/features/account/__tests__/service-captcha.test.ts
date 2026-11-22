import { changeAccountPassword, signInWithPassword, toAccountError } from "../service";

/**
 * Password sign-ins carry a Turnstile token (A1.4): the sign-in form AND the
 * re-sign-in that checks the current password before a change. A sign-in
 * refused for want of a token reads "No connection. Try again." (code
 * "network"), the line the form already shows for a server it cannot reach.
 */

const mockGetCaptchaToken = jest.fn<Promise<string | null>, []>();
let mockClient: ReturnType<typeof makeClient> | null = null;

jest.mock("@/features/captcha/token-broker", () => ({
  getCaptchaToken: () => mockGetCaptchaToken(),
}));
jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => mockClient,
  signInAnonymously: jest.fn(async () => undefined),
  resetAnonymousSignIn: jest.fn(),
}));
jest.mock("expo-file-system", () => ({
  File: jest.fn(),
  Directory: jest.fn(),
  Paths: {},
}));
jest.mock("@/features/felt/device-id", () => ({
  getDeviceId: async () => "device-1234-abcd",
}));

type Res = { data?: unknown; error?: unknown };
const ACCOUNT = { id: "uid-1", is_anonymous: false, email: "a@b.co" };

function makeClient() {
  return {
    auth: {
      getSession: jest.fn(async () => ({ data: { session: { user: ACCOUNT } } })),
      getUser: jest.fn(async () => ({ data: { user: { ...ACCOUNT, factors: [] } } })),
      signInWithPassword: jest.fn(async (..._a: unknown[]): Promise<Res> => ({
        data: { user: { id: "uid-1" }, session: { user: { id: "uid-1" } } },
        error: null,
      })),
      updateUser: jest.fn(async (..._a: unknown[]): Promise<Res> => ({
        data: { user: { id: "uid-1" } },
        error: null,
      })),
      signOut: jest.fn(async () => ({ error: null })),
      mfa: {
        getAuthenticatorAssuranceLevel: jest.fn(async () => ({
          data: { currentLevel: "aal1", nextLevel: "aal1" },
          error: null,
        })),
      },
    },
    rpc: jest.fn(async (..._a: unknown[]): Promise<Res> => ({ data: 0, error: null })),
  };
}

const CAPTCHA_REFUSAL = {
  code: "captcha_failed",
  status: 400,
  message:
    "captcha protection: request disallowed (no captcha response (captcha_token) found in request)",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockClient = makeClient();
  mockGetCaptchaToken.mockResolvedValue(null);
});

describe("signInWithPassword", () => {
  it("sends a fresh token with the email and password", async () => {
    mockGetCaptchaToken.mockResolvedValueOnce("tok-sign-in");
    await signInWithPassword("a@b.co", "secret-123");
    expect(mockClient!.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "a@b.co",
      password: "secret-123",
      options: { captchaToken: "tok-sign-in" },
    });
  });

  it("without a token sends exactly the old call", async () => {
    await signInWithPassword("a@b.co", "secret-123");
    expect(mockClient!.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "a@b.co",
      password: "secret-123",
    });
  });

  it("a CAPTCHA refusal shows the existing 'No connection' line", async () => {
    mockClient!.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: CAPTCHA_REFUSAL,
    });
    await expect(signInWithPassword("a@b.co", "secret-123")).rejects.toMatchObject({
      code: "network",
    });
    expect(
      toAccountError({ message: "captcha protection: request disallowed" }).code,
    ).toBe("network");
  });
});

describe("changeAccountPassword", () => {
  it("the re-sign-in with the current password sends its own fresh token", async () => {
    mockGetCaptchaToken.mockResolvedValueOnce("tok-recheck");
    await changeAccountPassword("the old one", "a brand new one");
    expect(mockClient!.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "a@b.co",
      password: "the old one",
      options: { captchaToken: "tok-recheck" },
    });
    expect(mockClient!.auth.updateUser).toHaveBeenCalledWith({
      password: "a brand new one",
    });
  });

  it("a CAPTCHA refusal there is 'No connection', never 'wrong current password', and changes nothing", async () => {
    mockClient!.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: CAPTCHA_REFUSAL,
    });
    await expect(
      changeAccountPassword("the old one", "a brand new one"),
    ).rejects.toMatchObject({
      code: "network",
    });
    expect(mockClient!.auth.updateUser).not.toHaveBeenCalled();
  });
});
