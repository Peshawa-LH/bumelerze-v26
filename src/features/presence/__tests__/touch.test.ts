import {
  PRESENCE_INTERVAL_MS,
  PRESENCE_STORAGE_KEY,
  __resetPresenceForTests,
  isTouchDue,
  touchPresenceOnce,
} from "../touch";

const mockGetItem = jest.fn();
const mockSetItem = jest.fn();
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: (key: string) => mockGetItem(key),
    setItem: (key: string, value: string) => mockSetItem(key, value),
  },
}));

const mockConfigured = jest.fn();
const mockRpc = jest.fn();
const mockGetSession = jest.fn();
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => mockConfigured(),
  getSupabaseClient: () => ({
    auth: { getSession: () => mockGetSession() },
    rpc: (name: string, args: unknown) => mockRpc(name, args),
  }),
}));

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { version: "1.2.3" } },
}));


const NOW = Date.parse("2026-10-10T12:00:00Z");

describe("isTouchDue", () => {
  it("is due with no stamp, a broken stamp, a stamp in the future, or after 24 hours", () => {
    expect(isTouchDue(null, NOW)).toBe(true);
    expect(isTouchDue(Number.NaN, NOW)).toBe(true);
    expect(isTouchDue(NOW + 1000, NOW)).toBe(true);
    expect(isTouchDue(NOW - PRESENCE_INTERVAL_MS, NOW)).toBe(true);
  });
  it("is not due within 24 hours", () => {
    expect(isTouchDue(NOW - PRESENCE_INTERVAL_MS + 1, NOW)).toBe(false);
    expect(isTouchDue(NOW - 60_000, NOW)).toBe(false);
  });
});

describe("touchPresenceOnce", () => {
  beforeEach(() => {
    __resetPresenceForTests();
    mockGetItem.mockReset().mockResolvedValue(null);
    mockSetItem.mockReset().mockResolvedValue(undefined);
    mockConfigured.mockReset().mockReturnValue(true);
    mockRpc.mockReset().mockResolvedValue({ error: null });
    mockGetSession.mockReset().mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
  });

  it("tells the server the platform, version and language, then stamps the day", async () => {
    await touchPresenceOnce(() => NOW);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    const [name, args] = mockRpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe("touch_presence");
    expect(Object.keys(args).sort()).toEqual(["p_app_version", "p_locale", "p_platform"]);
    expect(args.p_app_version).toBe("1.2.3");
    expect(["en", "ckb", "kmr", "ar"]).toContain(args.p_locale);
    expect(mockSetItem).toHaveBeenCalledWith(PRESENCE_STORAGE_KEY, String(NOW));
  });

  it("does nothing within 24 hours of the last call", async () => {
    mockGetItem.mockResolvedValue(String(NOW - 3_600_000));
    await touchPresenceOnce(() => NOW);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it("calls again the next day", async () => {
    mockGetItem.mockResolvedValue(String(NOW - PRESENCE_INTERVAL_MS - 1));
    await touchPresenceOnce(() => NOW);
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it("only once per app process", async () => {
    await touchPresenceOnce(() => NOW);
    await touchPresenceOnce(() => NOW + 1);
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it("never creates an identity: no session, no call, no stamp", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    await touchPresenceOnce(() => NOW);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it("does nothing without a Supabase project", async () => {
    mockConfigured.mockReturnValue(false);
    await touchPresenceOnce(() => NOW);
    expect(mockGetItem).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("keeps the stamp unset when the server says no, and never throws", async () => {
    mockRpc.mockResolvedValue({ error: { message: "boom" } });
    await expect(touchPresenceOnce(() => NOW)).resolves.toBeUndefined();
    expect(mockSetItem).not.toHaveBeenCalled();
    __resetPresenceForTests();
    mockRpc.mockRejectedValue(new Error("offline"));
    await expect(touchPresenceOnce(() => NOW)).resolves.toBeUndefined();
  });
});
