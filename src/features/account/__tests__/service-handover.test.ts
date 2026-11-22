/**
 * Moving a guest's reports into an account by SESSION, not by device id
 * (security audit DB-03, migration 0079): the token asked for while still a
 * guest, presented after sign-in, and the old `claim_device_reports` only on
 * a server that does not have the new functions yet.
 */
import { Platform } from "react-native";

import {
  claimThisDevicesReports,
  createAccountWithPassword,
  signInWithPassword,
  startOAuth,
} from "../service";
import {
  HANDOVER_CLIENT_TTL_MS,
  HANDOVER_PREPARE_TIMEOUT_MS,
  __resetHandoverForTests,
  hasHandoverToken,
} from "../handover";

const mockSignInAnonymously = jest.fn();
let mockClient: ReturnType<typeof makeClient> | null = null;

jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => mockClient,
  signInAnonymously: () => mockSignInAnonymously(),
  resetAnonymousSignIn: jest.fn(),
}));
jest.mock("expo-file-system", () => ({ File: jest.fn(), Directory: jest.fn(), Paths: {} }));
jest.mock("@/features/felt/device-id", () => ({
  getDeviceId: async () => "device-1234-abcd",
}));
jest.mock("../sign-out-data", () => ({
  sendWaitingItems: jest.fn(async () => 0),
  clearPersonalDataOnDevice: jest.fn(async () => undefined),
}));
const mockRunNativeOAuth = jest.fn();
jest.mock("../oauth-native", () => ({
  runNativeOAuth: (...args: unknown[]) => mockRunNativeOAuth(...args),
}));

type Res = { data?: unknown; error?: unknown };
const TOKEN = "ab".repeat(32);
const MISSING = { code: "PGRST202", message: "Could not find the function" };
const AAL1_ONLY = { currentLevel: "aal1", nextLevel: "aal1" };
const AAL1_NEEDS_CODE = { currentLevel: "aal1", nextLevel: "aal2" };

/** Server answers by RPC name; anything not listed answers `{ data: 0 }`. */
type Rpcs = Record<string, Res | (() => Promise<Res>)>;

function makeClient(
  user: { id: string; is_anonymous: boolean } | null,
  rpcs: Rpcs = {},
) {
  return {
    auth: {
      getSession: jest.fn(async () => ({ data: { session: user ? { user } : null } })),
      signInWithPassword: jest.fn(async (..._a: unknown[]): Promise<Res> => ({
        data: { user: { id: "uid-1" }, session: { user: { id: "uid-1" } } },
        error: null,
      })),
      updateUser: jest.fn(async (attrs: { email?: string }): Promise<Res> => ({
        data: { user: { id: "anon-1", email: attrs.email, is_anonymous: false } },
        error: null,
      })),
      refreshSession: jest.fn(async () => ({ data: {}, error: null })),
      signOut: jest.fn(async () => ({ error: null })),
      mfa: {
        getAuthenticatorAssuranceLevel: jest.fn(
          async (..._a: unknown[]): Promise<Res> => ({ data: AAL1_ONLY, error: null }),
        ),
      },
    },
    rpc: jest.fn(async (name: string, _args?: unknown): Promise<Res> => {
      const answer = rpcs[name];
      if (typeof answer === "function") {
        return await answer();
      }
      return answer ?? { data: 0, error: null };
    }),
  };
}

/** The server after migration 0079: hands out TOKEN, moves 3 rows for it. */
function newServer(): Rpcs {
  return {
    prepare_device_handover: { data: TOKEN, error: null },
    claim_device_handover: { data: 3, error: null },
    claim_device_reports: { data: null, error: { code: "42501", message: "permission denied" } },
  };
}

/** The server before 0079: only the device-id claim exists. */
function oldServer(): Rpcs {
  return {
    prepare_device_handover: { data: null, error: MISSING },
    claim_device_handover: { data: null, error: MISSING },
    claim_device_reports: { data: 5, error: null },
  };
}

function rpcNames(): string[] {
  return (mockClient?.rpc.mock.calls ?? []).map(([name]) => name as string);
}

const GUEST = { id: "anon-1", is_anonymous: true };
const ACCOUNT = { id: "uid-1", is_anonymous: false };
const realNow = Date.now;

beforeEach(() => {
  jest.clearAllMocks();
  __resetHandoverForTests();
  mockSignInAnonymously.mockResolvedValue(undefined);
  Date.now = realNow;
});
afterAll(() => {
  Date.now = realNow;
});

describe("signInWithPassword from a guest, server with migration 0079", () => {
  it("asks for the token while still a guest, signs in, then claims with it (never by device id)", async () => {
    mockClient = makeClient(GUEST, newServer());
    const result = await signInWithPassword("a@b.co", "correct horse");

    expect(result).toEqual({ userId: "uid-1", claimed: 3, needsCode: false });
    expect(rpcNames()).toEqual(["prepare_device_handover", "claim_device_handover"]);
    expect(mockClient.rpc).toHaveBeenCalledWith("claim_device_handover", { p_token: TOKEN });
    // Asked for before the password sign-in replaced the guest session.
    expect(mockClient.rpc.mock.invocationCallOrder[0] as number).toBeLessThan(
      mockClient.auth.signInWithPassword.mock.invocationCallOrder[0] as number,
    );
    // Single use: forgotten after the claim.
    expect(hasHandoverToken()).toBe(false);
  });

  it("a second claim has no token and moves nothing (no device-id fallback on this server)", async () => {
    mockClient = makeClient(GUEST, newServer());
    await signInWithPassword("a@b.co", "correct horse");
    mockClient.rpc.mockClear();

    await expect(claimThisDevicesReports()).resolves.toBe(0);
    expect(mockClient.rpc).not.toHaveBeenCalled();
  });

  it("keeps the token across the two-step code screen and claims with it after the code", async () => {
    mockClient = makeClient(GUEST, newServer());
    mockClient.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValueOnce({
      data: AAL1_NEEDS_CODE,
      error: null,
    });
    const result = await signInWithPassword("a@b.co", "correct horse");
    expect(result).toEqual({ userId: "uid-1", claimed: 0, needsCode: true });
    expect(rpcNames()).toEqual(["prepare_device_handover"]);
    expect(hasHandoverToken()).toBe(true);

    // app/account/sign-in.tsx (afterCode) and two-step-code.tsx, after the code:
    await expect(claimThisDevicesReports()).resolves.toBe(3);
    expect(mockClient.rpc).toHaveBeenLastCalledWith("claim_device_handover", {
      p_token: TOKEN,
    });
  });

  it("forgets the token when the sign-in fails (wrong password): nothing is ever claimed with it", async () => {
    mockClient = makeClient(GUEST, newServer());
    mockClient.auth.signInWithPassword.mockResolvedValueOnce({
      data: {},
      error: { code: "invalid_credentials", status: 400, message: "Invalid login credentials" },
    });
    await expect(signInWithPassword("a@b.co", "nope nope")).rejects.toMatchObject({
      code: "invalid_credentials",
    });
    expect(hasHandoverToken()).toBe(false);

    await expect(claimThisDevicesReports()).resolves.toBe(0);
    expect(rpcNames()).toEqual(["prepare_device_handover"]);
  });

  it("forgets the token when the sign-in throws (network)", async () => {
    mockClient = makeClient(GUEST, newServer());
    mockClient.auth.signInWithPassword.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(signInWithPassword("a@b.co", "correct horse")).rejects.toBeDefined();
    expect(hasHandoverToken()).toBe(false);
  });

  it("offers the token for 9 minutes only (the server keeps it 10)", async () => {
    const start = 1_800_000_000_000;
    Date.now = () => start;
    mockClient = makeClient(GUEST, newServer());
    mockClient.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValueOnce({
      data: AAL1_NEEDS_CODE,
      error: null,
    });
    await signInWithPassword("a@b.co", "correct horse");
    expect(HANDOVER_CLIENT_TTL_MS).toBe(9 * 60_000);

    Date.now = () => start + HANDOVER_CLIENT_TTL_MS + 1;
    await expect(claimThisDevicesReports()).resolves.toBe(0);
    expect(rpcNames()).toEqual(["prepare_device_handover"]);
  });

  it("ignores a malformed token", async () => {
    mockClient = makeClient(GUEST, {
      ...newServer(),
      prepare_device_handover: { data: "not-a-token", error: null },
    });
    await signInWithPassword("a@b.co", "correct horse");
    expect(mockClient.rpc).not.toHaveBeenCalledWith("claim_device_handover", {
      p_token: "not-a-token",
    });
    expect(mockClient.rpc).not.toHaveBeenCalledWith("claim_device_reports", expect.anything());
  });
});

describe("signInWithPassword: asking for the token never blocks the sign-in", () => {
  it("signs in when asking fails (offline, refused)", async () => {
    mockClient = makeClient(GUEST, {
      ...newServer(),
      prepare_device_handover: async () => {
        throw new TypeError("Network request failed");
      },
    });
    const result = await signInWithPassword("a@b.co", "correct horse");
    expect(result.needsCode).toBe(false);
    expect(mockClient.auth.signInWithPassword).toHaveBeenCalledTimes(1);
  });

  it("does not wait for a hanging request longer than the limit", async () => {
    jest.useFakeTimers();
    try {
      mockClient = makeClient(GUEST, {
        ...newServer(),
        prepare_device_handover: () => new Promise<Res>(() => undefined),
      });
      const pending = signInWithPassword("a@b.co", "correct horse");
      await jest.advanceTimersByTimeAsync(HANDOVER_PREPARE_TIMEOUT_MS + 10);
      const result = await pending;
      expect(mockClient.auth.signInWithPassword).toHaveBeenCalledTimes(1);
      expect(result.userId).toBe("uid-1");
      expect(hasHandoverToken()).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it("asks only from a guest session: an account (or no session) asks for nothing", async () => {
    mockClient = makeClient(ACCOUNT, newServer());
    await signInWithPassword("a@b.co", "correct horse");
    expect(rpcNames()).not.toContain("prepare_device_handover");

    mockClient = makeClient(null, newServer());
    await signInWithPassword("a@b.co", "correct horse");
    expect(rpcNames()).not.toContain("prepare_device_handover");
  });
});

describe("server without migration 0079 (the app ships first)", () => {
  it("falls back to claim_device_reports when the server lacks prepare_device_handover", async () => {
    mockClient = makeClient(GUEST, oldServer());
    const result = await signInWithPassword("a@b.co", "correct horse");
    expect(result.claimed).toBe(5);
    expect(mockClient.rpc).toHaveBeenCalledWith("claim_device_reports", {
      p_device_id: "device-1234-abcd",
    });
    expect(rpcNames()).not.toContain("claim_device_handover");
  });

  it("falls back when only the claim says the function is missing (42883)", async () => {
    mockClient = makeClient(ACCOUNT, {
      claim_device_handover: { data: null, error: { code: "42883", message: "function does not exist" } },
      claim_device_reports: { data: 4, error: null },
    });
    await expect(claimThisDevicesReports()).resolves.toBe(4);
    expect(rpcNames()).toEqual(["claim_device_handover", "claim_device_reports"]);
  });
});

describe("claimThisDevicesReports without a token, server support not known yet", () => {
  it("one claim with no token tells: a server with 0079 answers 0, and the device id is never sent", async () => {
    // e.g. the app restarted between the password and the code.
    mockClient = makeClient(ACCOUNT, { ...newServer(), claim_device_handover: { data: 0, error: null } });
    await expect(claimThisDevicesReports()).resolves.toBe(0);
    expect(rpcNames()).toEqual(["claim_device_handover"]);
    expect(mockClient.rpc).toHaveBeenCalledWith("claim_device_handover", { p_token: "" });
  });

  it("any other refusal moves nothing and never throws", async () => {
    mockClient = makeClient(ACCOUNT, {
      claim_device_handover: { data: null, error: { code: "42501", message: "denied" } },
    });
    await expect(claimThisDevicesReports()).resolves.toBe(0);
    expect(rpcNames()).not.toContain("claim_device_reports");

    mockClient.rpc.mockRejectedValueOnce(new Error("offline"));
    await expect(claimThisDevicesReports()).resolves.toBe(0);
  });
});

describe("creating an account from a guest needs no handover (same user, updateUser)", () => {
  it("calls no handover or claim RPC at all", async () => {
    mockClient = makeClient(GUEST, newServer());
    await createAccountWithPassword("a@b.co", "correct horse");
    expect(mockClient.auth.updateUser).toHaveBeenCalledTimes(1);
    expect(mockClient.rpc).not.toHaveBeenCalled();
  });
});

describe("startOAuth on iOS/Android", () => {
  const originalOS = Platform.OS;
  beforeEach(() => {
    Platform.OS = "ios";
  });
  afterEach(() => {
    Platform.OS = originalOS;
    mockRunNativeOAuth.mockReset();
  });

  it("a guest is upgraded in place: no token, no claim", async () => {
    mockClient = makeClient(GUEST, newServer());
    mockRunNativeOAuth.mockResolvedValueOnce("signedIn");
    await startOAuth("google");
    expect(mockClient.rpc).not.toHaveBeenCalled();
  });

  it("a plain sign-in claims like an email sign-in; a closed sheet forgets any token", async () => {
    mockClient = makeClient(null, newServer());
    mockRunNativeOAuth.mockResolvedValueOnce("signedIn");
    await startOAuth("apple");
    expect(rpcNames()).toEqual(["claim_device_handover"]);

    mockRunNativeOAuth.mockResolvedValueOnce("cancelled");
    await startOAuth("apple");
    expect(hasHandoverToken()).toBe(false);
  });
});
