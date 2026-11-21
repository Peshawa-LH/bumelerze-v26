import { accountHasPassword, changeAccountPassword } from "../service";

/**
 * The safer password change (security checklist A0.1), against a mocked
 * supabase-js: the current password is checked by signing in again as the
 * SAME account before anything changes, a session without its two-step code
 * is asked for one (aal1 -> aal2) before `updateUser`, and Supabase's
 * `insufficient_aal` becomes "code_needed". Which form applies comes from
 * `my_account_has_password()` (migration 0075).
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

describe("changeAccountPassword (an account that has a password)", () => {
  it("checks the current password by signing in as the account's own email, THEN changes it", async () => {
    await changeAccountPassword("the old one", "a brand new one");
    const auth = mockClient!.auth;
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "a@b.co",
      password: "the old one",
    });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: "a brand new one" });
    expect(auth.signInWithPassword.mock.invocationCallOrder[0] as number).toBeLessThan(
      auth.updateUser.mock.invocationCallOrder[0] as number,
    );
    // Not the service's sign-in: nothing is claimed, nobody is signed out.
    expect(mockClient!.rpc).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("a wrong current password changes nothing and says so", async () => {
    mockClient!.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { code: "invalid_credentials", status: 400, message: "Invalid login credentials" },
    });
    await expect(changeAccountPassword("wrong", "a brand new one")).rejects.toMatchObject({
      code: "current_password_wrong",
    });
    expect(mockClient!.auth.updateUser).not.toHaveBeenCalled();
    expect(mockClient!.auth.signOut).not.toHaveBeenCalled();
  });

  it("too many wrong tries is the rate-limit message", async () => {
    mockClient!.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { code: "over_request_rate_limit", status: 429, message: "Too many requests" },
    });
    await expect(changeAccountPassword("wrong", "a brand new one")).rejects.toMatchObject({
      code: "rate_limited",
    });
  });

  it("never stays signed in to a different account (and changes nothing)", async () => {
    mockClient!.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: { id: "someone-else" }, session: { user: { id: "someone-else" } } },
      error: null,
    });
    await expect(changeAccountPassword("the old one", "a brand new one")).rejects.toMatchObject(
      { code: "unknown" },
    );
    expect(mockClient!.auth.updateUser).not.toHaveBeenCalled();
    expect(mockClient!.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mockResetAnonymousSignIn).toHaveBeenCalled();
  });

  it("with two-step sign-in on, the fresh session must give its code first: 'code_needed', no change yet", async () => {
    mockClient!.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValueOnce({
      data: AAL1_NEEDS_CODE,
      error: null,
    });
    await expect(changeAccountPassword("the old one", "a brand new one")).rejects.toMatchObject(
      { code: "code_needed" },
    );
    expect(mockClient!.auth.updateUser).not.toHaveBeenCalled();
  });

  it("maps Supabase's insufficient_aal on updateUser to 'code_needed'", async () => {
    mockClient!.auth.updateUser.mockResolvedValueOnce({
      data: null,
      error: {
        code: "insufficient_aal",
        status: 401,
        message: "AAL2 session is required to update email or password when MFA is enabled.",
      },
    });
    await expect(changeAccountPassword("the old one", "a brand new one")).rejects.toMatchObject(
      { code: "code_needed" },
    );
  });

  it("checks the new password and an empty current one before any request", async () => {
    await expect(changeAccountPassword("the old one", "short")).rejects.toMatchObject({
      code: "weak_password",
    });
    await expect(changeAccountPassword("", "a brand new one")).rejects.toMatchObject({
      code: "current_password_wrong",
    });
    expect(mockClient!.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("needs a signed-in account", async () => {
    mockClient = makeClient({ id: "anon", is_anonymous: true });
    await expect(changeAccountPassword("the old one", "a brand new one")).rejects.toMatchObject(
      { code: "no_session" },
    );
    expect(mockClient.auth.signInWithPassword).not.toHaveBeenCalled();
  });
});

describe("accountHasPassword (migration 0075)", () => {
  it("asks my_account_has_password() with no arguments", async () => {
    mockClient!.rpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await accountHasPassword()).toBe(true);
    expect(mockClient!.rpc).toHaveBeenCalledWith("my_account_has_password");
    mockClient!.rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await accountHasPassword()).toBe(false);
  });

  it("answers null before 0075 is on the server (the old form stays)", async () => {
    mockClient!.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    });
    expect(await accountHasPassword()).toBeNull();
  });

  it("throws on no connection so the screen can offer Retry", async () => {
    mockClient!.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "TypeError: Failed to fetch" },
    });
    await expect(accountHasPassword()).rejects.toMatchObject({ code: "network" });
  });
});
