import { __resetAccountStoreForTests, ensureAccountSync, useAccountStore } from "../store";

type Listener = (event: string, session: unknown) => void;
let mockListener: Listener | null = null;
let mockSession: unknown = null;

jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: mockSession } }),
      onAuthStateChange: (cb: Listener) => {
        mockListener = cb;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      },
    },
  }),
}));
jest.mock("../service", () => ({
  loadProfile: async () => ({
    profile: { userId: "u1", displayName: "Shilan", avatarPath: null },
    privateProfile: null,
  }),
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("account store", () => {
  beforeEach(() => {
    __resetAccountStoreForTests();
    mockListener = null;
    mockSession = null;
  });

  it("treats an anonymous session as anonymous", async () => {
    mockSession = { user: { id: "u1", is_anonymous: true } };
    ensureAccountSync();
    await flush();
    expect(useAccountStore.getState()).toMatchObject({ status: "anonymous", userId: "u1" });
  });

  it("treats a non-anonymous user as an account and loads the profile", async () => {
    mockSession = { user: { id: "u1", is_anonymous: false, email: "a@b.co" } };
    ensureAccountSync();
    await flush();
    expect(useAccountStore.getState()).toMatchObject({
      status: "account",
      userId: "u1",
      email: "a@b.co",
      profileLoaded: true,
    });
    expect(useAccountStore.getState().profile?.displayName).toBe("Shilan");
  });

  it("drops back to anonymous on sign-out", async () => {
    mockSession = { user: { id: "u1", is_anonymous: false, email: "a@b.co" } };
    ensureAccountSync();
    await flush();
    mockListener?.("SIGNED_OUT", null);
    expect(useAccountStore.getState()).toMatchObject({
      status: "anonymous",
      userId: null,
      profile: null,
    });
  });
});
