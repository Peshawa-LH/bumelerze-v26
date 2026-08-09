/**
 * `getDefaultFeltTransport` — the actual selection switch the wave brief
 * asked for ("Wire transport selection in queue.ts: SupabaseTransport when
 * configured, else the existing PendingTransport"). No real network call:
 * `@supabase/supabase-js`'s `createClient` is never exercised beyond being
 * constructed (mocked here), matching `src/lib/__tests__/supabase.test.ts`'s
 * own no-network discipline.
 */

const ORIGINAL_ENV = { ...process.env };

jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(() => ({ auth: {}, from: jest.fn() })),
}));

function loadQueue(): typeof import("../queue") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh require after resetModules
  return require("../queue");
}

function loadSupabaseTransport(): typeof import("../supabase-transport") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see loadQueue
  return require("../supabase-transport");
}

function setEnv(url: string | undefined, anonKey: string | undefined): void {
  if (url === undefined) {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  } else {
    process.env.EXPO_PUBLIC_SUPABASE_URL = url;
  }
  if (anonKey === undefined) {
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  } else {
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = anonKey;
  }
}

beforeEach(() => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("getDefaultFeltTransport", () => {
  it("resolves to PendingTransport when Supabase is not configured (today's unchanged default)", () => {
    setEnv(undefined, undefined);
    const { getDefaultFeltTransport, PendingTransport } = loadQueue();

    expect(getDefaultFeltTransport()).toBe(PendingTransport);
  });

  it("resolves to SupabaseTransport once both env vars are set", () => {
    setEnv("https://example.supabase.co", "anon-key-value");
    const { getDefaultFeltTransport } = loadQueue();
    const { SupabaseTransport } = loadSupabaseTransport();

    expect(getDefaultFeltTransport()).toBe(SupabaseTransport);
  });

  it("enqueueTier1Report with no explicit transport still resolves to 'awaiting-backend' when unconfigured", async () => {
    setEnv(undefined, undefined);
    jest.doMock("expo-crypto", () => ({
      randomUUID: () => "test-transport-selection-uuid",
    }));
    const { enqueueTier1Report, useFeltQueueStore } = loadQueue();

    const report = await enqueueTier1Report({
      cartoonLevel: 3,
      location: { quality: "gps", lat: 36.19, lon: 44.01 },
      eventId: null,
    });

    // Give the fire-and-forget processQueue() call (using the default
    // transport, since none was passed explicitly) a turn to settle.
    for (
      let attempt = 0;
      attempt < 50 &&
      useFeltQueueStore
        .getState()
        .items.find((item) => item.tier1.reportId === report.reportId)?.state !==
        "awaiting-backend";
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const stored = useFeltQueueStore
      .getState()
      .items.find((item) => item.tier1.reportId === report.reportId);
    expect(stored?.state).toBe("awaiting-backend");
  });
});
