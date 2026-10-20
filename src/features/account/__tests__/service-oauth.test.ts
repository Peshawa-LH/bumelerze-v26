/**
 * `startOAuth`: Google / Apple sign-in (flag-gated, off today). The web
 * hands the page to the provider; iOS/Android run the in-app sign-in sheet
 * (oauth-native.ts, mocked here) and come back signed in.
 */
import { Platform } from "react-native";

import { startOAuth } from "../service";
import { AccountError } from "../types";

let mockClient: ReturnType<typeof makeClient> | null = null;
jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => mockClient,
  signInAnonymously: jest.fn(),
  resetAnonymousSignIn: jest.fn(),
}));
jest.mock("@/features/felt/device-id", () => ({
  getDeviceId: async () => "device-1234-abcd",
}));
const mockRunNativeOAuth = jest.fn();
jest.mock("../oauth-native", () => ({
  runNativeOAuth: (...args: unknown[]) => mockRunNativeOAuth(...args),
}));

type Res = { data?: unknown; error?: unknown };

function makeClient(user: { id: string; is_anonymous: boolean } | null) {
  return {
    auth: {
      getSession: jest.fn(async () => ({ data: { session: user ? { user } : null } })),
      linkIdentity: jest.fn(async (..._a: unknown[]): Promise<Res> => ({
        data: {},
        error: null,
      })),
      signInWithOAuth: jest.fn(async (..._a: unknown[]): Promise<Res> => ({
        data: {},
        error: null,
      })),
    },
    rpc: jest.fn(async (..._a: unknown[]): Promise<Res> => ({ data: 2, error: null })),
  };
}

const originalOS = Platform.OS;
afterEach(() => {
  Platform.OS = originalOS;
  mockRunNativeOAuth.mockReset();
});

describe("startOAuth on iOS/Android", () => {
  beforeEach(() => {
    Platform.OS = "ios";
  });

  it("upgrades this install's guest in the sign-in sheet (no 'not available' error any more)", async () => {
    mockClient = makeClient({ id: "guest-1", is_anonymous: true });
    mockRunNativeOAuth.mockResolvedValueOnce("signedIn");

    await expect(startOAuth("google")).resolves.toBe("signedIn");

    expect(mockRunNativeOAuth).toHaveBeenCalledWith(mockClient, "google", true);
    // Same user id: nothing to move.
    expect(mockClient.rpc).not.toHaveBeenCalled();
  });

  it("moves this device's reports into the account after a plain sign-in, like email sign-in", async () => {
    mockClient = makeClient(null);
    mockRunNativeOAuth.mockResolvedValueOnce("signedIn");

    await expect(startOAuth("apple")).resolves.toBe("signedIn");

    expect(mockRunNativeOAuth).toHaveBeenCalledWith(mockClient, "apple", false);
    expect(mockClient.rpc).toHaveBeenCalledWith("claim_device_reports", {
      p_device_id: "device-1234-abcd",
    });
  });

  it("reports a closed sheet as cancelled and changes nothing", async () => {
    mockClient = makeClient(null);
    mockRunNativeOAuth.mockResolvedValueOnce("cancelled");
    await expect(startOAuth("google")).resolves.toBe("cancelled");
    expect(mockClient.rpc).not.toHaveBeenCalled();
  });

  it("maps failures to the account error texts", async () => {
    mockClient = makeClient({ id: "guest-1", is_anonymous: true });
    mockRunNativeOAuth.mockRejectedValueOnce(new TypeError("Network request failed"));
    await expect(startOAuth("google")).rejects.toMatchObject({ code: "network" });
    mockRunNativeOAuth.mockRejectedValueOnce({
      code: "identity_already_exists",
      message: "x",
    });
    await expect(startOAuth("google")).rejects.toMatchObject({ code: "email_taken" });
  });

  it("still needs a configured backend", async () => {
    mockClient = null;
    await expect(startOAuth("google")).rejects.toEqual(new AccountError("unconfigured"));
    expect(mockRunNativeOAuth).not.toHaveBeenCalled();
  });
});

describe("startOAuth on the web (unchanged)", () => {
  const hadLocation = Object.prototype.hasOwnProperty.call(window, "location");
  const originalLocation = window.location;
  beforeEach(() => {
    Platform.OS = "web";
    Object.defineProperty(window, "location", {
      value: { origin: "https://app.bumelerze.com" },
      configurable: true,
      writable: true,
    });
  });
  afterEach(() => {
    if (hadLocation) {
      Object.defineProperty(window, "location", {
        value: originalLocation,
        configurable: true,
        writable: true,
      });
    } else {
      delete (window as { location?: unknown }).location;
    }
  });

  it("links the guest and hands the page to the provider", async () => {
    mockClient = makeClient({ id: "guest-1", is_anonymous: true });
    await expect(startOAuth("google")).resolves.toBe("redirecting");
    expect(mockClient.auth.linkIdentity).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "https://app.bumelerze.com" },
    });
    expect(mockRunNativeOAuth).not.toHaveBeenCalled();
  });

  it("signs in with the provider when there is no guest", async () => {
    mockClient = makeClient(null);
    await expect(startOAuth("apple")).resolves.toBe("redirecting");
    expect(mockClient.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "apple",
      options: { redirectTo: "https://app.bumelerze.com" },
    });
  });
});
