import { SupabaseTransport } from "../supabase-transport";

/** The two RPCs of migration 0064 behind "Withdraw" and its Undo. */
const mockRpc = jest.fn();
jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => ({ rpc: (...args: unknown[]) => mockRpc(...args) }),
  signInAnonymously: jest.fn(() => Promise.resolve()),
}));

describe("withdraw and restore over Supabase", () => {
  beforeEach(() => mockRpc.mockReset());

  it("sends the report id with the device id (the ownership proof), nothing else", async () => {
    mockRpc.mockResolvedValue({ data: { withdrawn_at: "x" }, error: null });
    expect(await SupabaseTransport.withdrawReport?.("r1", "device-1234abcd")).toBe(
      "withdrawn",
    );
    expect(mockRpc).toHaveBeenCalledWith("withdraw_felt_report", {
      p_report_id: "r1",
      p_device_id: "device-1234abcd",
    });
  });

  it("maps not_found and any other error", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0002", message: "withdraw_felt_report: not_found" },
    });
    expect(await SupabaseTransport.withdrawReport?.("r1", "d")).toBe("not_found");
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST202", message: "no function" },
    });
    expect(await SupabaseTransport.withdrawReport?.("r1", "d")).toBe("failed");
    mockRpc.mockRejectedValueOnce(new Error("Failed to fetch"));
    expect(await SupabaseTransport.withdrawReport?.("r1", "d")).toBe("failed");
  });

  it("restores, and tells too-late and a newer report apart", async () => {
    mockRpc.mockResolvedValueOnce({ data: {}, error: null });
    expect(await SupabaseTransport.restoreReport?.("r1", "d")).toBe("restored");
    expect(mockRpc).toHaveBeenLastCalledWith("restore_felt_report", {
      p_report_id: "r1",
      p_device_id: "d",
    });
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "22023", message: "restore_felt_report: expired" },
    });
    expect(await SupabaseTransport.restoreReport?.("r1", "d")).toBe("expired");
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "22023", message: "restore_felt_report: conflict" },
    });
    expect(await SupabaseTransport.restoreReport?.("r1", "d")).toBe("conflict");
  });
});
