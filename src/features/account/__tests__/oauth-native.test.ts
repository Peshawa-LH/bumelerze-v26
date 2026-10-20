import type { SupabaseClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

import { NATIVE_AUTH_CALLBACK_URL } from "@/features/links/incoming";
import {
  completeOAuthCallback,
  readOAuthCallback,
  runNativeOAuth,
} from "../oauth-native";
import { AccountError } from "../types";

const mockOpenAuthSession = jest.fn();
jest.mock("expo-web-browser", () => ({
  openAuthSessionAsync: (...args: unknown[]) => mockOpenAuthSession(...args),
}));

type Res = { data?: unknown; error?: unknown };

function makeClient() {
  const auth = {
    linkIdentity: jest.fn(async (..._a: unknown[]): Promise<Res> => ({
      data: {
        provider: "google",
        url: "https://x.supabase.co/auth/v1/user/identities/authorize?p=google",
      },
      error: null,
    })),
    signInWithOAuth: jest.fn(async (..._a: unknown[]): Promise<Res> => ({
      data: { provider: "apple", url: "https://x.supabase.co/auth/v1/authorize?p=apple" },
      error: null,
    })),
    exchangeCodeForSession: jest.fn(async (..._a: unknown[]): Promise<Res> => ({
      data: {},
      error: null,
    })),
    setSession: jest.fn(async (..._a: unknown[]): Promise<Res> => ({
      data: {},
      error: null,
    })),
  };
  return { auth, client: { auth } as unknown as SupabaseClient };
}

beforeEach(() => {
  mockOpenAuthSession.mockReset();
});

describe("readOAuthCallback", () => {
  it("reads a PKCE code from the query", () => {
    expect(readOAuthCallback(`${NATIVE_AUTH_CALLBACK_URL}?code=abc123`)).toMatchObject({
      code: "abc123",
      accessToken: null,
      error: null,
    });
  });

  it("reads the implicit-flow tokens from the # part", () => {
    expect(
      readOAuthCallback(
        `${NATIVE_AUTH_CALLBACK_URL}#access_token=a.b.c&expires_in=3600&refresh_token=r1&token_type=bearer`,
      ),
    ).toMatchObject({ code: null, accessToken: "a.b.c", refreshToken: "r1" });
  });

  it("reads a provider error, preferring the precise code", () => {
    expect(
      readOAuthCallback(
        `${NATIVE_AUTH_CALLBACK_URL}?error=server_error&error_code=identity_already_exists&error_description=Identity+is+already+linked`,
      ),
    ).toMatchObject({
      error: "identity_already_exists",
      errorDescription: "Identity is already linked",
    });
  });
});

describe("completeOAuthCallback", () => {
  it("exchanges a code for the session", async () => {
    const { auth, client } = makeClient();
    await expect(
      completeOAuthCallback(client, `${NATIVE_AUTH_CALLBACK_URL}?code=abc`),
    ).resolves.toBe("signedIn");
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("abc");
  });

  it("stores the session the implicit flow returns", async () => {
    const { auth, client } = makeClient();
    await expect(
      completeOAuthCallback(
        client,
        `${NATIVE_AUTH_CALLBACK_URL}#access_token=t&refresh_token=r`,
      ),
    ).resolves.toBe("signedIn");
    expect(auth.setSession).toHaveBeenCalledWith({
      access_token: "t",
      refresh_token: "r",
    });
  });

  it("treats a declined consent as cancelled, without a message", async () => {
    const { auth, client } = makeClient();
    await expect(
      completeOAuthCallback(client, `${NATIVE_AUTH_CALLBACK_URL}?error=access_denied`),
    ).resolves.toBe("cancelled");
    expect(auth.setSession).not.toHaveBeenCalled();
  });

  it("fails on any other provider error, or a return without a session", async () => {
    const { client } = makeClient();
    await expect(
      completeOAuthCallback(client, `${NATIVE_AUTH_CALLBACK_URL}?error=server_error`),
    ).rejects.toBeInstanceOf(AccountError);
    await expect(
      completeOAuthCallback(client, NATIVE_AUTH_CALLBACK_URL),
    ).rejects.toBeInstanceOf(AccountError);
  });

  it("passes a failed exchange on", async () => {
    const { auth, client } = makeClient();
    auth.exchangeCodeForSession.mockResolvedValueOnce({
      data: null,
      error: { message: "bad code" },
    });
    await expect(
      completeOAuthCallback(client, `${NATIVE_AUTH_CALLBACK_URL}?code=x`),
    ).rejects.toEqual({ message: "bad code" });
  });
});

describe("runNativeOAuth", () => {
  it("links the provider to the guest in the in-app sign-in sheet, returning to bumelerze://auth/callback", async () => {
    const { auth, client } = makeClient();
    mockOpenAuthSession.mockResolvedValueOnce({
      type: "success",
      url: `${NATIVE_AUTH_CALLBACK_URL}#access_token=t&refresh_token=r`,
    });

    await expect(runNativeOAuth(client, "google", true)).resolves.toBe("signedIn");

    expect(auth.linkIdentity).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "bumelerze://auth/callback", skipBrowserRedirect: true },
    });
    expect(auth.signInWithOAuth).not.toHaveBeenCalled();
    expect(mockOpenAuthSession).toHaveBeenCalledWith(
      "https://x.supabase.co/auth/v1/user/identities/authorize?p=google",
      "bumelerze://auth/callback",
    );
    expect(auth.setSession).toHaveBeenCalledWith({
      access_token: "t",
      refresh_token: "r",
    });
  });

  it("signs in with the provider when there is no guest to upgrade", async () => {
    const { auth, client } = makeClient();
    mockOpenAuthSession.mockResolvedValueOnce({
      type: "success",
      url: `${NATIVE_AUTH_CALLBACK_URL}?code=c`,
    });
    await expect(runNativeOAuth(client, "apple", false)).resolves.toBe("signedIn");
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "apple",
      options: { redirectTo: "bumelerze://auth/callback", skipBrowserRedirect: true },
    });
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("c");
  });

  it.each(["cancel", "dismiss", "locked"])(
    "ends quietly when the sheet closes without signing in (%s)",
    async (type) => {
      const { auth, client } = makeClient();
      mockOpenAuthSession.mockResolvedValueOnce({ type });
      await expect(runNativeOAuth(client, "google", true)).resolves.toBe("cancelled");
      expect(auth.setSession).not.toHaveBeenCalled();
      expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    },
  );

  it("never opens the sheet when Supabase refuses to start", async () => {
    const { auth, client } = makeClient();
    auth.linkIdentity.mockResolvedValueOnce({
      data: null,
      error: { message: "Manual linking is disabled", code: "manual_linking_disabled" },
    });
    await expect(runNativeOAuth(client, "google", true)).rejects.toMatchObject({
      code: "manual_linking_disabled",
    });
    expect(mockOpenAuthSession).not.toHaveBeenCalled();
  });
});

describe("the web download", () => {
  it("never carries the in-app sign-in sheet (oauth-native.web.ts is its own twin)", () => {
    const web = fs.readFileSync(path.join(__dirname, "../oauth-native.web.ts"), "utf8");
    expect(web).not.toMatch(/from "expo-web-browser"/);
    expect(web).toMatch(/export async function runNativeOAuth\(/);
    expect(web).toMatch(/export type NativeOAuthOutcome = "signedIn" \| "cancelled";/);
  });
});
