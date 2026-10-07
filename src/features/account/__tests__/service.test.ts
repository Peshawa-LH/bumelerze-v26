import {
  claimThisDevicesReports,
  deleteAccount,
  requestEmailCode,
  saveProfile,
  signOutAccount,
  toAccountError,
  verifyEmailCode,
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
      updateUser: jest.fn(ok),
      verifyOtp: jest.fn(async (..._a: unknown[]): Promise<Res> => ({
        data: { user: { id: "uid-1" } },
        error: null,
      })),
      signInWithOtp: jest.fn(ok),
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

describe("requestEmailCode", () => {
  it("upgrades the anonymous user by attaching the email", async () => {
    const result = await requestEmailCode("  a@b.co ");
    expect(result).toEqual({ mode: "upgrade" });
    expect(mockClient?.auth.updateUser).toHaveBeenCalledWith({ email: "a@b.co" });
    expect(mockClient?.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("falls back to a sign-in code when the email already has an account", async () => {
    mockClient?.auth.updateUser.mockResolvedValueOnce({
      data: {},
      error: {
        code: "email_exists",
        status: 422,
        message: "A user with this email address has already been registered",
      },
    });
    const result = await requestEmailCode("a@b.co");
    expect(result).toEqual({ mode: "signin" });
    expect(mockClient?.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "a@b.co",
      options: { shouldCreateUser: false },
    });
  });

  it("rejects an implausible email without calling Supabase", async () => {
    await expect(requestEmailCode("not-an-email")).rejects.toMatchObject({
      code: "invalid_email",
    });
    expect(mockClient?.auth.updateUser).not.toHaveBeenCalled();
  });

  it("maps rate limiting", async () => {
    mockClient?.auth.updateUser.mockResolvedValueOnce({
      data: {},
      error: {
        code: "over_email_send_rate_limit",
        status: 429,
        message: "email rate limit exceeded",
      },
    });
    await expect(requestEmailCode("a@b.co")).rejects.toMatchObject({
      code: "rate_limited",
    });
  });

  it("is unavailable when Supabase is not configured", async () => {
    mockClient = null;
    await expect(requestEmailCode("a@b.co")).rejects.toMatchObject({
      code: "unconfigured",
    });
  });
});

describe("verifyEmailCode", () => {
  it("verifies an upgrade with the email_change type and moves nothing", async () => {
    const result = await verifyEmailCode("a@b.co", "123 456", "upgrade");
    expect(mockClient?.auth.verifyOtp).toHaveBeenCalledWith({
      email: "a@b.co",
      token: "123456",
      type: "email_change",
    });
    expect(result).toEqual({ userId: "uid-1", claimed: 0 });
    expect(mockClient?.rpc).not.toHaveBeenCalled();
  });

  it("signs into an existing account then claims this device's reports", async () => {
    const result = await verifyEmailCode("a@b.co", "123456", "signin");
    expect(mockClient?.auth.verifyOtp).toHaveBeenCalledWith({
      email: "a@b.co",
      token: "123456",
      type: "email",
    });
    expect(mockClient?.rpc).toHaveBeenCalledWith("claim_device_reports", {
      p_device_id: "device-1234-abcd",
    });
    expect(result.claimed).toBe(3);
  });

  it("still signs in when claiming fails", async () => {
    mockClient?.rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const result = await verifyEmailCode("a@b.co", "123456", "signin");
    expect(result.claimed).toBe(0);
  });

  it("maps a wrong or expired code", async () => {
    mockClient?.auth.verifyOtp.mockResolvedValueOnce({
      data: {},
      error: {
        code: "otp_expired",
        status: 403,
        message: "Token has expired or is invalid",
      },
    });
    await expect(verifyEmailCode("a@b.co", "000000", "upgrade")).rejects.toMatchObject({
      code: "invalid_code",
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
