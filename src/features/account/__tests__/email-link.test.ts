import { Platform } from "react-native";

import { completeEmailLink, getEmailRedirectUrl, readAuthUrlError, requestEmailCode } from "../service";

type Res = { data?: unknown; error?: unknown };

let mockClient: ReturnType<typeof makeClient> | null = null;

jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => mockClient,
  signInAnonymously: async () => undefined,
  resetAnonymousSignIn: () => undefined,
}));
jest.mock("@/features/felt/device-id", () => ({
  getDeviceId: async () => "device-1234-abcd",
}));

function makeClient(
  user: { id: string; is_anonymous: boolean } | null,
  profileRow: { user_id: string; display_name: string; avatar_path: null } | null = null,
) {
  const result = async (..._a: unknown[]): Promise<Res> => ({ data: {}, error: null });
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: profileRow, error: null }),
  };
  return {
    auth: {
      getSession: jest.fn(async () => ({ data: { session: user ? { user } : null } })),
      updateUser: jest.fn(result),
      signInWithOtp: jest.fn(result),
    },
    rpc: jest.fn(async (..._a: unknown[]): Promise<Res> => ({ data: 2, error: null })),
    from: jest.fn(() => query),
  };
}

function setWeb(location: { origin: string; hash: string; search: string }) {
  jest.replaceProperty(Platform, "OS", "web");
  Object.defineProperty(globalThis, "window", { value: { location }, configurable: true });
}

afterEach(() => {
  jest.restoreAllMocks();
  delete (globalThis as { window?: unknown }).window;
  delete process.env.EXPO_BASE_URL;
});

describe("email link redirect", () => {
  it("is undefined on native", () => {
    expect(getEmailRedirectUrl()).toBeUndefined();
  });

  it("is origin + base path + callback on web, sent with the upgrade email", async () => {
    setWeb({ origin: "https://bumelerze.com", hash: "", search: "" });
    process.env.EXPO_BASE_URL = "/app";
    mockClient = makeClient({ id: "u", is_anonymous: true });
    await requestEmailCode("a@b.co");
    expect(mockClient.auth.updateUser).toHaveBeenCalledWith(
      { email: "a@b.co" },
      { emailRedirectTo: "https://bumelerze.com/app/account/callback" },
    );
  });

  it("is sent with the sign-in email for an existing account", async () => {
    setWeb({ origin: "https://bumelerze.com", hash: "", search: "" });
    process.env.EXPO_BASE_URL = "/app";
    mockClient = makeClient({ id: "u", is_anonymous: false });
    await requestEmailCode("a@b.co");
    expect(mockClient.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "a@b.co",
      options: {
        shouldCreateUser: false,
        emailRedirectTo: "https://bumelerze.com/app/account/callback",
      },
    });
  });
});

describe("readAuthUrlError", () => {
  it("reads error_description from the hash or the query", () => {
    setWeb({ origin: "https://x", hash: "#error=access_denied&error_description=Email+link+expired", search: "" });
    expect(readAuthUrlError()).toBe("Email link expired");
    setWeb({ origin: "https://x", hash: "", search: "?error_description=gone" });
    expect(readAuthUrlError()).toBe("gone");
    setWeb({ origin: "https://x", hash: "#access_token=abc", search: "" });
    expect(readAuthUrlError()).toBeNull();
  });
});

describe("completeEmailLink", () => {
  it("reports expired when the URL carries an error", async () => {
    setWeb({ origin: "https://x", hash: "#error=access_denied&error_code=otp_expired", search: "" });
    mockClient = makeClient({ id: "u", is_anonymous: false });
    await expect(completeEmailLink(0)).resolves.toEqual({ status: "expired" });
  });

  it("goes to profile setup (hasProfile false) for a new account and claims reports", async () => {
    mockClient = makeClient({ id: "u", is_anonymous: false });
    await expect(completeEmailLink(0)).resolves.toEqual({
      status: "ok",
      userId: "u",
      hasProfile: false,
      claimed: 2,
    });
    expect(mockClient.rpc).toHaveBeenCalledWith("claim_device_reports", {
      p_device_id: "device-1234-abcd",
    });
  });

  it("reports an existing profile", async () => {
    mockClient = makeClient(
      { id: "u", is_anonymous: false },
      { user_id: "u", display_name: "Shilan", avatar_path: null },
    );
    await expect(completeEmailLink(0)).resolves.toMatchObject({ status: "ok", hasProfile: true });
  });

  it("reports expired when no account session shows up in time", async () => {
    mockClient = makeClient({ id: "u", is_anonymous: true });
    await expect(completeEmailLink(0)).resolves.toEqual({ status: "expired" });
    mockClient = makeClient(null);
    await expect(completeEmailLink(0)).resolves.toEqual({ status: "expired" });
  });
});
