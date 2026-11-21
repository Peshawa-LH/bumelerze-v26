import { setAccountPassword, signInWithPassword, toAccountError } from "../service";

/**
 * The account service with two-step sign-in on (security checklist A0.1),
 * against a mocked supabase-js: a password sign-in that still needs its
 * code moves no reports yet, and Supabase's MFA errors reach the screens
 * as "code_needed" / "wrong_code".
 */

const mockSignInAnonymously = jest.fn();
const mockResetAnonymousSignIn = jest.fn();
let mockClient: ReturnType<typeof makeClient> | null = null;

jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => mockClient,
  signInAnonymously: () => mockSignInAnonymously(),
  resetAnonymousSignIn: () => mockResetAnonymousSignIn(),
}));
jest.mock("expo-file-system", () => ({ File: jest.fn(), Directory: jest.fn(), Paths: {} }));
jest.mock("@/features/felt/device-id", () => ({
  getDeviceId: async () => "device-1234-abcd",
}));

type Res = { data?: unknown; error?: unknown };
const ACCOUNT = { id: "uid-1", is_anonymous: false, email: "a@b.co" };
const AAL1_ONLY = { currentLevel: "aal1", nextLevel: "aal1" };
const AAL1_NEEDS_CODE = { currentLevel: "aal1", nextLevel: "aal2" };

function makeClient(user: { id: string; is_anonymous: boolean; email?: string } | null) {
  return {
    auth: {
      getSession: jest.fn(async () => ({ data: { session: user ? { user } : null } })),
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
        getAuthenticatorAssuranceLevel: jest.fn(
          async (..._a: unknown[]): Promise<Res> => ({ data: AAL1_ONLY, error: null }),
        ),
      },
    },
    rpc: jest.fn(async (..._a: unknown[]): Promise<Res> => ({ data: 2, error: null })),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSignInAnonymously.mockResolvedValue(undefined);
  mockClient = makeClient(ACCOUNT);
});

describe("signInWithPassword with two-step sign-in on", () => {
  it("asks for the code and moves no reports yet", async () => {
    mockClient = makeClient({ id: "anon-device", is_anonymous: true });
    mockClient.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValueOnce({
      data: AAL1_NEEDS_CODE,
      error: null,
    });
    const result = await signInWithPassword("a@b.co", "correct horse");
    expect(result).toEqual({ userId: "uid-1", claimed: 0, needsCode: true });
    expect(mockClient.rpc).not.toHaveBeenCalled();
  });

  it("an account without it signs in and moves the reports as before", async () => {
    const result = await signInWithPassword("a@b.co", "correct horse");
    expect(result).toEqual({ userId: "uid-1", claimed: 2, needsCode: false });
    expect(mockClient!.rpc).toHaveBeenCalledWith("claim_device_reports", {
      p_device_id: "device-1234-abcd",
    });
  });
});

describe("setAccountPassword (no password yet, or after the code)", () => {
  it("maps insufficient_aal to 'code_needed'", async () => {
    mockClient!.auth.updateUser.mockResolvedValueOnce({
      data: null,
      error: { code: "insufficient_aal", status: 401, message: "AAL2 session is required" },
    });
    await expect(setAccountPassword("a brand new one")).rejects.toMatchObject({
      code: "code_needed",
    });
  });
});

describe("toAccountError for two-step sign-in", () => {
  it.each([
    [{ code: "insufficient_aal" }, "code_needed"],
    [{ message: "AAL2 required to unenroll verified factor" }, "code_needed"],
    [{ code: "mfa_verification_failed" }, "wrong_code"],
    [{ message: "Invalid TOTP code entered" }, "wrong_code"],
    [{ code: "mfa_challenge_expired" }, "wrong_code"],
    [{ code: "session_not_found" }, "no_session"],
    [{ code: "invalid_credentials" }, "invalid_credentials"],
  ])("%j -> %s", (error, code) => {
    expect(toAccountError(error).code).toBe(code);
  });
});
