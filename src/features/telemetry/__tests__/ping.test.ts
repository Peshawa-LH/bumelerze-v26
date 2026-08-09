import * as fs from "node:fs";
import * as path from "node:path";

import { Platform } from "react-native";

import { encodeGeohash } from "@/lib/felt-aggregation";

/**
 * Cold-start telemetry ping — no real network call anywhere in this file.
 * `@/lib/supabase` and `expo-location` are both mocked at their seams
 * (same "mock the module boundary, test the pure mapping separately"
 * pattern as `features/felt/__tests__/supabase-transport.test.ts`).
 */

const mockGetForegroundPermissionsAsync = jest.fn();
const mockGetLastKnownPositionAsync = jest.fn();

jest.mock("expo-location", () => ({
  PermissionStatus: {
    GRANTED: "granted",
    DENIED: "denied",
    UNDETERMINED: "undetermined",
  },
  getForegroundPermissionsAsync: () => mockGetForegroundPermissionsAsync(),
  getLastKnownPositionAsync: () => mockGetLastKnownPositionAsync(),
}));

const mockIsSupabaseConfigured = jest.fn();
const mockGetSupabaseClient = jest.fn();

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => mockIsSupabaseConfigured(),
  getSupabaseClient: () => mockGetSupabaseClient(),
}));

function loadPing(): typeof import("../ping") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh require after resetModules, per this codebase's discipline
  return require("../ping");
}

function setPlatformOS(os: string): void {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true });
}

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  setPlatformOS("ios");
});

afterEach(() => {
  setPlatformOS("ios");
});

describe("buildTelemetryPingInsert (pure mapping)", () => {
  it("encodes the coordinates at precision 4 and passes the platform through", () => {
    const { buildTelemetryPingInsert } = loadPing();

    const payload = buildTelemetryPingInsert(35.56, 45.43, "android");

    expect(payload).toEqual({
      geohash: encodeGeohash(35.56, 45.43, 4),
      platform: "android",
    });
    expect(payload.geohash).toHaveLength(4);
  });

  it("never carries fine-grained coordinates — precision 4 only, never 5/6", () => {
    const { buildTelemetryPingInsert } = loadPing();

    const p4 = buildTelemetryPingInsert(35.56, 45.43, "ios");
    const p6 = encodeGeohash(35.56, 45.43, 6);

    expect(p4.geohash).toHaveLength(4);
    // The finer geohash always starts with the coarser one as a prefix —
    // proving p4 genuinely is the truncated, less-precise value, not an
    // unrelated string.
    expect(p6.startsWith(p4.geohash)).toBe(true);
    expect(p4.geohash).not.toBe(p6);
  });

  it("never includes a device_id or any per-device field", () => {
    const { buildTelemetryPingInsert } = loadPing();

    const payload = buildTelemetryPingInsert(35.56, 45.43, "web");

    expect(Object.keys(payload).sort()).toEqual(["geohash", "platform"]);
  });

  it("every payload key is a real telemetry_pings column (schema/app sync check)", () => {
    const { buildTelemetryPingInsert } = loadPing();
    const sqlPath = path.join(
      __dirname,
      "../../../../supabase/migrations/0005_notifications_and_telemetry.sql",
    );
    const sql = fs.readFileSync(sqlPath, "utf8");
    const startMarker = "create table public.telemetry_pings (";
    const startIdx = sql.indexOf(startMarker);
    const bodyStart = startIdx + startMarker.length;
    const endIdx = sql.indexOf("\n);", bodyStart);
    const columns = sql
      .slice(bodyStart, endIdx)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("--"))
      .map((line) => /^([a-z_][a-z0-9_]*)\s+/i.exec(line)?.[1])
      .filter((name): name is string => Boolean(name));

    for (const key of Object.keys(buildTelemetryPingInsert(35.56, 45.43, "android"))) {
      expect(columns).toContain(key);
    }
  });
});

describe("sendColdStartTelemetryPing", () => {
  it("does nothing when Supabase is not configured — no permission check, no insert", async () => {
    mockIsSupabaseConfigured.mockReturnValue(false);
    const { sendColdStartTelemetryPing } = loadPing();

    await sendColdStartTelemetryPing();

    expect(mockGetForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(mockGetSupabaseClient).not.toHaveBeenCalled();
  });

  it("never requests permission — skips the ping outright when not already granted", async () => {
    mockIsSupabaseConfigured.mockReturnValue(true);
    mockGetForegroundPermissionsAsync.mockResolvedValue({ status: "denied" });
    const { sendColdStartTelemetryPing } = loadPing();

    await sendColdStartTelemetryPing();

    expect(mockGetLastKnownPositionAsync).not.toHaveBeenCalled();
    expect(mockGetSupabaseClient).not.toHaveBeenCalled();
  });

  it("never forces a fresh GPS fix — skips the ping when nothing is cached", async () => {
    mockIsSupabaseConfigured.mockReturnValue(true);
    mockGetForegroundPermissionsAsync.mockResolvedValue({ status: "granted" });
    mockGetLastKnownPositionAsync.mockResolvedValue(null);
    const { sendColdStartTelemetryPing } = loadPing();

    await sendColdStartTelemetryPing();

    expect(mockGetSupabaseClient).not.toHaveBeenCalled();
  });

  it("inserts a coarse ping once permission + a cached fix + configuration all line up", async () => {
    mockIsSupabaseConfigured.mockReturnValue(true);
    mockGetForegroundPermissionsAsync.mockResolvedValue({ status: "granted" });
    mockGetLastKnownPositionAsync.mockResolvedValue({
      coords: { latitude: 35.56, longitude: 45.43 },
    });
    const insert = jest.fn(async () => ({ error: null }));
    const from = jest.fn(() => ({ insert }));
    mockGetSupabaseClient.mockReturnValue({ from });
    const { sendColdStartTelemetryPing } = loadPing();

    await sendColdStartTelemetryPing();

    expect(from).toHaveBeenCalledWith("telemetry_pings");
    expect(insert).toHaveBeenCalledWith({
      geohash: encodeGeohash(35.56, 45.43, 4),
      platform: "ios",
    });
  });

  it("fires at most once per process — a second call is a no-op even if config later flips", async () => {
    mockIsSupabaseConfigured.mockReturnValue(true);
    mockGetForegroundPermissionsAsync.mockResolvedValue({ status: "granted" });
    mockGetLastKnownPositionAsync.mockResolvedValue({
      coords: { latitude: 35.56, longitude: 45.43 },
    });
    const insert = jest.fn(async () => ({ error: null }));
    mockGetSupabaseClient.mockReturnValue({ from: jest.fn(() => ({ insert })) });
    const { sendColdStartTelemetryPing } = loadPing();

    await sendColdStartTelemetryPing();
    await sendColdStartTelemetryPing();

    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("skips silently for a platform outside the ios/android/web CHECK constraint", async () => {
    mockIsSupabaseConfigured.mockReturnValue(true);
    setPlatformOS("windows");
    const { sendColdStartTelemetryPing } = loadPing();

    await sendColdStartTelemetryPing();

    expect(mockGetForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it("never throws, even if the insert call rejects", async () => {
    mockIsSupabaseConfigured.mockReturnValue(true);
    mockGetForegroundPermissionsAsync.mockResolvedValue({ status: "granted" });
    mockGetLastKnownPositionAsync.mockResolvedValue({
      coords: { latitude: 35.56, longitude: 45.43 },
    });
    mockGetSupabaseClient.mockReturnValue({
      from: () => ({
        insert: () => Promise.reject(new Error("network blip")),
      }),
    });
    const { sendColdStartTelemetryPing } = loadPing();

    await expect(sendColdStartTelemetryPing()).resolves.toBeUndefined();
  });
});
