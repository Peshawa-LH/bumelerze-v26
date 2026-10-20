/**
 * The phone app's alert RPCs (migration 0062, plus 0068 for the release):
 * the Expo token is registered with the app language through the same
 * function the server already has, removed as its owner, released after a
 * sign-out, and a missing 0068 reads as "unavailable" (so the caller can
 * fall back) rather than as a failure.
 */
import { parseSubscriptionId, SupabaseAlertsTransport } from "../transport";
import { AlertsError } from "../types";

const mockRpc = jest.fn();

jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => ({ rpc: (...args: unknown[]) => mockRpc(...args) }),
  isSupabaseConfigured: () => true,
}));

const TOKEN = "ExponentPushToken[abcdefghijklmnop]";
const ID = "8b0f5a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

beforeEach(() => {
  mockRpc.mockReset();
});

it("registers the phone's token with the app language and returns the server's id for it", async () => {
  mockRpc.mockResolvedValue({ data: ID, error: null });
  await expect(SupabaseAlertsTransport.registerExpoPush(TOKEN, "ckb")).resolves.toBe(ID);
  expect(mockRpc).toHaveBeenCalledWith("alerts_register_expo_push", { p_token: TOKEN, p_locale: "ckb" });
});

it("removes the phone as its owner with the token, never an endpoint", async () => {
  mockRpc.mockResolvedValue({ data: 1, error: null });
  await SupabaseAlertsTransport.unregisterExpoPush(TOKEN);
  expect(mockRpc).toHaveBeenCalledWith("alerts_unregister_push", { p_endpoint: null, p_expo_token: TOKEN });
});

it("releases the phone from whoever registered it (0068)", async () => {
  mockRpc.mockResolvedValue({ data: 1, error: null });
  await SupabaseAlertsTransport.releaseExpoPush(TOKEN);
  expect(mockRpc).toHaveBeenCalledWith("alerts_release_expo_push", { p_token: TOKEN });
});

it("before 0068 is live the release is 'unavailable', not a failure", async () => {
  mockRpc.mockResolvedValue({
    data: null,
    error: { code: "PGRST202", message: "Could not find the function public.alerts_release_expo_push(p_token)" },
  });
  await expect(SupabaseAlertsTransport.releaseExpoPush(TOKEN)).rejects.toMatchObject({ code: "unavailable" });
});

it("words the server's refusals: a tester list without this account, a bad token", async () => {
  mockRpc.mockResolvedValueOnce({ data: null, error: { message: "alerts_register_expo_push: not_enabled" } });
  await expect(SupabaseAlertsTransport.registerExpoPush(TOKEN, "en")).rejects.toEqual(
    new AlertsError("not_enabled", "alerts_register_expo_push: not_enabled"),
  );
  mockRpc.mockResolvedValueOnce({ data: null, error: { message: "alerts_register_expo_push: token_invalid" } });
  await expect(SupabaseAlertsTransport.registerExpoPush("nope", "en")).rejects.toMatchObject({ code: "invalid" });
});

it("an answer that is not an id still counts as registered (no id to mark the row)", () => {
  expect(parseSubscriptionId(ID)).toBe(ID);
  expect(parseSubscriptionId(null)).toBeNull();
  expect(parseSubscriptionId("not-a-uuid")).toBeNull();
  expect(parseSubscriptionId(42)).toBeNull();
});
