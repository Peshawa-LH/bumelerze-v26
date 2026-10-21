import { CommunityError } from "@/features/community/types";
import { signInAnonymously } from "@/lib/supabase";

import { SupabasePeopleSearchTransport } from "../transport";

const mockRpc = jest.fn();
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => ({ rpc: (...args: unknown[]) => mockRpc(...args) }),
  signInAnonymously: jest.fn(async () => undefined),
}));

describe("SupabasePeopleSearchTransport", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    jest.mocked(signInAnonymously).mockClear();
  });

  it("makes sure there is a session (a guest's), then asks mention_suggestions", async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          user_id: "u1",
          username: "dilan.k",
          display_name: "Dilan",
          avatar_path: null,
          relation: "following",
        },
        { user_id: "broken" },
      ],
      error: null,
    });
    const people = await SupabasePeopleSearchTransport.search("di");
    expect(signInAnonymously).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("mention_suggestions", { p_prefix: "di" });
    expect(people).toEqual([
      {
        userId: "u1",
        username: "dilan.k",
        displayName: "Dilan",
        avatarPath: null,
        relation: "following",
      },
    ]);
  });

  it("passes a server error on, so the screen can say so", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom", code: "XX000" } });
    await expect(SupabasePeopleSearchTransport.search("di")).rejects.toBeInstanceOf(
      CommunityError,
    );
  });

  it("fails cleanly when no guest session can be made (offline)", async () => {
    jest.mocked(signInAnonymously).mockRejectedValueOnce(new Error("Failed to fetch"));
    await expect(SupabasePeopleSearchTransport.search("di")).rejects.toBeInstanceOf(
      CommunityError,
    );
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
