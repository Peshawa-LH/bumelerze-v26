import {
  claimThisDevicesReports,
  deleteAccount,
  createAccountWithPassword,
  setAccountPassword,
  signInWithPassword,
  saveProfile,
  signOutAccount,
  toAccountError,
} from "../service";
import { AccountError } from "../types";
import { RESEARCH_CONSENT_VERSION, TERMS_VERSION } from "../constants";

const mockSignInAnonymously = jest.fn();
const mockResetAnonymousSignIn = jest.fn();
let mockClient: ReturnType<typeof makeClient> | null = null;

jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => mockClient,
  signInAnonymously: () => mockSignInAnonymously(),
  resetAnonymousSignIn: () => mockResetAnonymousSignIn(),
}));

jest.mock("@/features/felt/device-id", () => ({
  getDeviceId: async () => "device-1234-abcd",
}));

type Anyfn = jest.Mock;
type Res = { data?: unknown; error?: unknown };
const ok = async (..._args: unknown[]): Promise<Res> => ({ data: {}, error: null });

function makeClient(user: { id: string; is_anonymous: boolean } | null) {
  const upsert: Anyfn = jest.fn(async () => ({ error: null }));
  const remove: Anyfn = jest.fn(async () => ({ data: [], error: null }));
  const list: Anyfn = jest.fn(async () => ({
    data: [{ name: "avatar-1.jpg" }],
    error: null,
  }));
  const from: Anyfn = jest.fn(() => ({ upsert }));
  return {
    auth: {
      getSession: jest.fn(async () => ({ data: { session: user ? { user } : null } })),
      // Echoes the email back like GoTrue does when confirmation is off.
      updateUser: jest.fn(async (attrs: { email?: string }): Promise<Res> => ({
        data: { user: { id: "uid-1", email: attrs.email, is_anonymous: false } },
        error: null,
      })),
      refreshSession: jest.fn(ok),
      signInWithPassword: jest.fn(async (..._a: unknown[]): Promise<Res> => ({
        data: { user: { id: "uid-1" }, session: {} },
        error: null,
      })),
      signInWithOtp: jest.fn(ok),
      verifyOtp: jest.fn(ok),
      signOut: jest.fn(async () => ({ error: null })),
    },
    rpc: jest.fn(async (..._a: unknown[]): Promise<Res> => ({ data: 3, error: null })),
    from,
    upsert,
    storage: {
      from: jest.fn(() => ({ remove, list, upload: jest.fn(), getPublicUrl: jest.fn() })),
    },
    remove,
    list,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSignInAnonymously.mockResolvedValue(undefined);
  mockClient = makeClient({ id: "uid-1", is_anonymous: true });
});

describe("createAccountWithPassword", () => {
  it("upgrades the anonymous user in place with one updateUser call (email + password)", async () => {
    await createAccountWithPassword("  A@B.co ", "correct horse");
    expect(mockClient?.auth.updateUser).toHaveBeenCalledTimes(1);
    expect(mockClient?.auth.updateUser).toHaveBeenCalledWith({
      email: "A@B.co",
      password: "correct horse",
    });
    expect(mockSignInAnonymously).toHaveBeenCalled();
  });

  it("sends no email: no OTP, no redirect option, no verification step", async () => {
    await createAccountWithPassword("a@b.co", "correct horse");
    expect(mockClient?.auth.signInWithOtp).not.toHaveBeenCalled();
    expect(mockClient?.auth.verifyOtp).not.toHaveBeenCalled();
    // updateUser got exactly one argument: no { emailRedirectTo }.
    expect(mockClient?.auth.updateUser.mock.calls[0]).toHaveLength(1);
  });

  it("refreshes the session so the access token stops saying is_anonymous", async () => {
    await createAccountWithPassword("a@b.co", "correct horse");
    expect(mockClient?.auth.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("still succeeds when the refresh fails (offline right after)", async () => {
    mockClient?.auth.refreshSession.mockRejectedValueOnce(new Error("offline"));
    await expect(
      createAccountWithPassword("a@b.co", "correct horse"),
    ).resolves.toBeUndefined();
  });

  it("rejects an implausible email or a short password without calling Supabase", async () => {
    await expect(
      createAccountWithPassword("not-an-email", "correct horse"),
    ).rejects.toMatchObject({
      code: "invalid_email",
    });
    await expect(createAccountWithPassword("a@b.co", "short")).rejects.toMatchObject({
      code: "weak_password",
    });
    await expect(
      createAccountWithPassword("a@b.co", "x".repeat(73)),
    ).rejects.toMatchObject({ code: "weak_password" });
    expect(mockClient?.auth.updateUser).not.toHaveBeenCalled();
  });

  it("maps an email that already has an account", async () => {
    mockClient?.auth.updateUser.mockResolvedValueOnce({
      data: {},
      error: {
        code: "email_exists",
        status: 422,
        message: "A user with this email address has already been registered",
      },
    });
    await expect(
      createAccountWithPassword("a@b.co", "correct horse"),
    ).rejects.toMatchObject({
      code: "email_taken",
    });
  });

  it("maps a password the server finds weak", async () => {
    mockClient?.auth.updateUser.mockResolvedValueOnce({
      data: {},
      error: {
        code: "weak_password",
        status: 422,
        message: "Password should be at least 10 characters.",
      },
    });
    await expect(
      createAccountWithPassword("a@b.co", "correct horse"),
    ).rejects.toMatchObject({
      code: "weak_password",
    });
  });

  it("maps being offline", async () => {
    mockClient?.auth.updateUser.mockResolvedValueOnce({
      data: {},
      error: { name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" },
    });
    await expect(
      createAccountWithPassword("a@b.co", "correct horse"),
    ).rejects.toMatchObject({
      code: "network",
    });
  });

  it("does not claim success when the server only recorded a pending email change", async () => {
    mockClient?.auth.updateUser.mockResolvedValueOnce({
      data: { user: { id: "uid-1", email: "", new_email: "a@b.co", is_anonymous: true } },
      error: null,
    });
    await expect(
      createAccountWithPassword("a@b.co", "correct horse"),
    ).rejects.toMatchObject({
      code: "setup_incomplete",
    });
    expect(mockClient?.auth.refreshSession).not.toHaveBeenCalled();
  });

  it("refuses when this device already has an account", async () => {
    mockClient = makeClient({ id: "uid-1", is_anonymous: false });
    await expect(
      createAccountWithPassword("a@b.co", "correct horse"),
    ).rejects.toBeInstanceOf(AccountError);
    expect(mockClient.auth.updateUser).not.toHaveBeenCalled();
  });

  it("is unavailable when Supabase is not configured", async () => {
    mockClient = null;
    await expect(
      createAccountWithPassword("a@b.co", "correct horse"),
    ).rejects.toMatchObject({
      code: "unconfigured",
    });
  });
});

describe("signInWithPassword", () => {
  it("signs in with the trimmed email and the password as typed", async () => {
    await signInWithPassword(" a@b.co ", " pass word ");
    expect(mockClient?.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "a@b.co",
      password: " pass word ",
    });
    expect(mockClient?.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("then claims this device's reports into the account", async () => {
    const result = await signInWithPassword("a@b.co", "correct horse");
    expect(mockClient?.rpc).toHaveBeenCalledWith("claim_device_reports", {
      p_device_id: "device-1234-abcd",
    });
    expect(result).toEqual({ userId: "uid-1", claimed: 3 });
  });

  it("still signs in when claiming fails", async () => {
    mockClient?.rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const result = await signInWithPassword("a@b.co", "correct horse");
    expect(result.claimed).toBe(0);
  });

  it("maps wrong credentials and does not claim anything", async () => {
    mockClient?.auth.signInWithPassword.mockResolvedValueOnce({
      data: {},
      error: {
        code: "invalid_credentials",
        status: 400,
        message: "Invalid login credentials",
      },
    });
    await expect(signInWithPassword("a@b.co", "nope nope")).rejects.toMatchObject({
      code: "invalid_credentials",
    });
    expect(mockClient?.rpc).not.toHaveBeenCalled();
  });

  it("maps rate limiting and being offline", async () => {
    mockClient?.auth.signInWithPassword.mockResolvedValueOnce({
      data: {},
      error: {
        code: "over_request_rate_limit",
        status: 429,
        message: "Too many requests",
      },
    });
    await expect(signInWithPassword("a@b.co", "correct horse")).rejects.toMatchObject({
      code: "rate_limited",
    });
    mockClient?.auth.signInWithPassword.mockResolvedValueOnce({
      data: {},
      error: { name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" },
    });
    await expect(signInWithPassword("a@b.co", "correct horse")).rejects.toMatchObject({
      code: "network",
    });
  });

  it("rejects an implausible email or an empty password locally", async () => {
    await expect(signInWithPassword("nope", "x")).rejects.toMatchObject({
      code: "invalid_email",
    });
    await expect(signInWithPassword("a@b.co", "")).rejects.toMatchObject({
      code: "invalid_credentials",
    });
    expect(mockClient?.auth.signInWithPassword).not.toHaveBeenCalled();
  });
});

describe("setAccountPassword", () => {
  beforeEach(() => {
    mockClient = makeClient({ id: "uid-1", is_anonymous: false });
  });

  it("calls updateUser with only the password (no email attribute, so nothing to confirm)", async () => {
    await setAccountPassword("a brand new one");
    expect(mockClient?.auth.updateUser).toHaveBeenCalledTimes(1);
    expect(mockClient?.auth.updateUser).toHaveBeenCalledWith({
      password: "a brand new one",
    });
  });

  it("refuses a short password without calling Supabase", async () => {
    await expect(setAccountPassword("short")).rejects.toMatchObject({
      code: "weak_password",
    });
    expect(mockClient?.auth.updateUser).not.toHaveBeenCalled();
  });

  it("needs a real account, not a guest", async () => {
    mockClient = makeClient({ id: "uid-1", is_anonymous: true });
    await expect(setAccountPassword("a brand new one")).rejects.toMatchObject({
      code: "no_session",
    });
    expect(mockClient.auth.updateUser).not.toHaveBeenCalled();
  });

  it("maps same-password and reauthentication errors", async () => {
    mockClient?.auth.updateUser.mockResolvedValueOnce({
      data: {},
      error: {
        code: "same_password",
        status: 422,
        message: "New password should be different from the old password.",
      },
    });
    await expect(setAccountPassword("a brand new one")).rejects.toMatchObject({
      code: "same_password",
    });
    mockClient?.auth.updateUser.mockResolvedValueOnce({
      data: {},
      error: {
        code: "reauthentication_needed",
        status: 400,
        message: "Reauthentication needed",
      },
    });
    await expect(setAccountPassword("a brand new one")).rejects.toMatchObject({
      code: "reauth_needed",
    });
  });
});

describe("claimThisDevicesReports", () => {
  it("returns 0 and never throws on failure", async () => {
    mockClient?.rpc.mockRejectedValueOnce(new Error("offline"));
    await expect(claimThisDevicesReports()).resolves.toBe(0);
  });
});

describe("signOutAccount", () => {
  it("signs out locally, resets the memo and signs in anonymously again", async () => {
    await signOutAccount();
    expect(mockClient?.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mockResetAnonymousSignIn).toHaveBeenCalledTimes(1);
    expect(mockSignInAnonymously).toHaveBeenCalledTimes(1);
    const signOutOrder = mockClient?.auth.signOut.mock.invocationCallOrder[0] ?? 0;
    expect(mockResetAnonymousSignIn.mock.invocationCallOrder[0]).toBeGreaterThan(
      signOutOrder,
    );
    expect(mockSignInAnonymously.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockResetAnonymousSignIn.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("survives being offline for the anonymous sign-in", async () => {
    mockSignInAnonymously.mockRejectedValueOnce(new Error("offline"));
    await expect(signOutAccount()).resolves.toBeUndefined();
  });
});

describe("deleteAccount", () => {
  it("removes avatar files, calls the RPC, then returns to anonymous", async () => {
    mockClient = makeClient({ id: "uid-1", is_anonymous: false });
    await deleteAccount();
    expect(mockClient.list).toHaveBeenCalledWith("uid-1");
    expect(mockClient.remove).toHaveBeenCalledWith(["uid-1/avatar-1.jpg"]);
    expect(mockClient.rpc).toHaveBeenCalledWith("delete_my_account");
    expect(mockClient.auth.signOut).toHaveBeenCalled();
    expect(mockResetAnonymousSignIn).toHaveBeenCalled();
    expect(mockSignInAnonymously).toHaveBeenCalled();
  });

  it("removes the photo files of the homes this person owns before the RPC (SQL cannot delete storage objects)", async () => {
    mockClient = makeClient({ id: "uid-1", is_anonymous: false });
    const eq2: Anyfn = jest.fn(async () => ({
      data: [{ tag_id: "tag-1" }, { tag_id: "tag-2" }],
      error: null,
    }));
    const eq1: Anyfn = jest.fn(() => ({ eq: eq2 }));
    const select: Anyfn = jest.fn(() => ({ eq: eq1 }));
    mockClient.from.mockImplementation((table: string) =>
      table === "home_members" ? { select } : { upsert: mockClient?.upsert },
    );
    await deleteAccount();
    expect(select).toHaveBeenCalledWith("tag_id");
    expect(eq1).toHaveBeenCalledWith("user_id", "uid-1");
    expect(eq2).toHaveBeenCalledWith("role", "owner");
    expect(mockClient.list).toHaveBeenCalledWith("tag-1", expect.anything());
    expect(mockClient.list).toHaveBeenCalledWith("tag-2", expect.anything());
    expect(mockClient.remove).toHaveBeenCalledWith(["tag-1/avatar-1.jpg"]);
    expect(mockClient.remove).toHaveBeenCalledWith(["tag-2/avatar-1.jpg"]);
    const rpcOrder = mockClient.rpc.mock.invocationCallOrder[0] as number;
    for (const call of mockClient.remove.mock.invocationCallOrder) {
      expect(call).toBeLessThan(rpcOrder);
    }
  });

  it("goes on with the deletion when the homes' files cannot be listed", async () => {
    mockClient = makeClient({ id: "uid-1", is_anonymous: false });
    mockClient.from.mockImplementation(() => {
      throw new Error("offline");
    });
    await deleteAccount();
    expect(mockClient.rpc).toHaveBeenCalledWith("delete_my_account");
    expect(mockClient.auth.signOut).toHaveBeenCalled();
  });

  it("does not sign out when the database refuses the deletion", async () => {
    mockClient = makeClient({ id: "uid-1", is_anonymous: false });
    mockClient.rpc.mockResolvedValueOnce({ data: null, error: { message: "denied" } });
    await expect(deleteAccount()).rejects.toBeInstanceOf(AccountError);
    expect(mockClient.auth.signOut).not.toHaveBeenCalled();
  });

  it("refuses for an anonymous user", async () => {
    await expect(deleteAccount()).rejects.toMatchObject({ code: "no_session" });
    expect(mockClient?.rpc).not.toHaveBeenCalled();
  });
});

describe("saveProfile", () => {
  const base = {
    displayName: "  Shilan  ",
    profession: "teacher" as const,
    termsAccepted: true,
    researchConsent: true,
    avatar: { kind: "keep" } as const,
    locale: "ckb",
  };

  beforeEach(() => {
    mockClient = makeClient({ id: "uid-1", is_anonymous: false });
  });

  it("upserts the public and the private profile with consent versions", async () => {
    await saveProfile(base);
    const calls = mockClient?.from.mock.calls.map((c) => c[0]);
    expect(calls).toEqual(["profiles", "profile_private"]);
    const [publicRow] = mockClient?.upsert.mock.calls[0] ?? [];
    expect(publicRow).toEqual({ user_id: "uid-1", display_name: "Shilan" });
    const [privateRow] = mockClient?.upsert.mock.calls[1] ?? [];
    expect(privateRow).toMatchObject({
      user_id: "uid-1",
      profession: "teacher",
      locale: "ckb",
      terms_version: TERMS_VERSION,
      research_consent_version: RESEARCH_CONSENT_VERSION,
    });
    expect(typeof privateRow.terms_accepted_at).toBe("string");
  });

  it("records the community guidelines and the age tick with the first acceptance of the terms (sign-up)", async () => {
    await saveProfile(base);
    expect(mockClient?.rpc).toHaveBeenCalledWith("accept_guidelines", {
      p_version: "g1",
      p_age_ok: true,
      p_source: "signup",
    });
  });

  it("does not ask again when the terms were accepted before", async () => {
    await saveProfile({
      ...base,
      previous: {
        profile: null,
        privateProfile: {
          profession: null,
          locale: "en",
          termsVersion: TERMS_VERSION,
          termsAcceptedAt: "2026-10-04T00:00:00Z",
          researchConsentVersion: null,
          researchConsentAt: null,
          hideBadges: false,
        },
      },
    });
    expect(mockClient?.rpc).not.toHaveBeenCalledWith(
      "accept_guidelines",
      expect.anything(),
    );
  });

  it("still saves the profile when recording the guidelines fails (the first comment asks again)", async () => {
    mockClient?.rpc.mockResolvedValue({
      data: null,
      error: { message: "Failed to fetch" },
    });
    await expect(saveProfile(base)).resolves.toBeUndefined();
  });

  it("clears research consent when unchecked and keeps unchanged terms time", async () => {
    await saveProfile({
      ...base,
      researchConsent: false,
      profession: null,
      previous: {
        profile: {
          userId: "uid-1",
          displayName: "Old",
          avatarPath: null,
          username: null,
          isPrivate: false,
          communityReady: true,
        },
        privateProfile: {
          profession: "teacher",
          locale: "en",
          termsVersion: TERMS_VERSION,
          termsAcceptedAt: "2026-10-04T00:00:00Z",
          researchConsentVersion: RESEARCH_CONSENT_VERSION,
          researchConsentAt: "2026-10-04T00:00:00Z",
          hideBadges: false,
        },
      },
    });
    const [privateRow] = mockClient?.upsert.mock.calls[1] ?? [];
    expect(privateRow.profession).toBeNull();
    expect(privateRow.research_consent_version).toBeNull();
    expect(privateRow).not.toHaveProperty("terms_accepted_at");
  });

  it("validates name length and required terms before any write", async () => {
    await expect(saveProfile({ ...base, displayName: "A" })).rejects.toMatchObject({
      code: "name_length",
    });
    await expect(
      saveProfile({ ...base, displayName: "x".repeat(41) }),
    ).rejects.toMatchObject({
      code: "name_length",
    });
    await expect(saveProfile({ ...base, termsAccepted: false })).rejects.toMatchObject({
      code: "terms_required",
    });
    expect(mockClient?.from).not.toHaveBeenCalled();
  });

  it("removes the avatar path and deletes the old file when asked", async () => {
    await saveProfile({
      ...base,
      avatar: { kind: "remove" },
      previous: {
        profile: {
          userId: "uid-1",
          displayName: "Old",
          avatarPath: "uid-1/avatar-1.jpg",
          username: null,
          isPrivate: false,
          communityReady: true,
        },
        privateProfile: null,
      },
    });
    const [publicRow] = mockClient?.upsert.mock.calls[0] ?? [];
    expect(publicRow.avatar_path).toBeNull();
    expect(mockClient?.remove).toHaveBeenCalledWith(["uid-1/avatar-1.jpg"]);
  });
});

describe("toAccountError", () => {
  it("passes AccountError through and maps unknown shapes", () => {
    const original = new AccountError("network");
    expect(toAccountError(original)).toBe(original);
    expect(toAccountError("weird").code).toBe("unknown");
    expect(toAccountError({ name: "AuthRetryableFetchError", message: "x" }).code).toBe(
      "network",
    );
  });
});
