import {
  GuidelinesError,
  SupabaseGuidelinesTransport,
  toGuidelinesError,
} from "../transport";
import { GUIDELINES_VERSION } from "../constants";

const mockRpc = jest.fn();
const mockSignIn = jest.fn();
let mockClient: { rpc: jest.Mock } | null = null;
jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => mockClient,
  signInAnonymously: () => mockSignIn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSignIn.mockResolvedValue(undefined);
  mockRpc.mockResolvedValue({ data: null, error: null });
  mockClient = { rpc: mockRpc };
});

describe("SupabaseGuidelinesTransport", () => {
  it("signs in as a guest first, then records version, age tick and source", async () => {
    await SupabaseGuidelinesTransport.accept("prompt");
    expect(mockSignIn).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("accept_guidelines", {
      p_version: GUIDELINES_VERSION,
      p_age_ok: true,
      p_source: "prompt",
    });
  });

  it("is version g1, matching the migration", () => {
    expect(GUIDELINES_VERSION).toBe("g1");
  });

  it("maps a missing function (migration not applied) to unavailable", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "x" } });
    await expect(SupabaseGuidelinesTransport.accept("signup")).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("maps a network failure and any other failure", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "Failed to fetch" } });
    await expect(SupabaseGuidelinesTransport.accept("prompt")).rejects.toMatchObject({
      code: "network",
    });
    mockRpc.mockResolvedValue({ data: null, error: { message: "age_required" } });
    await expect(SupabaseGuidelinesTransport.accept("prompt")).rejects.toBeInstanceOf(
      GuidelinesError,
    );
  });

  it("fails as unavailable without a configured client", async () => {
    mockClient = null;
    await expect(SupabaseGuidelinesTransport.accept("prompt")).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("toGuidelinesError keeps its own errors", () => {
    const own = new GuidelinesError("network");
    expect(toGuidelinesError(own)).toBe(own);
  });
});
