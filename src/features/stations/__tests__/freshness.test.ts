import {
  classifyFreshness,
  freshnessFromCatalog,
  LIVE_MAX_AGE_MS,
  liveMaxAgeMs,
  RASPBERRY_SHAKE_LIVE_MAX_AGE_MS,
} from "../freshness";

describe("station freshness", () => {
  const now = Date.parse("2026-09-27T19:00:00Z");
  it("calls a station live within ten minutes, recent within a day, silent beyond", () => {
    expect(classifyFreshness(now - 5 * 60_000, now)).toBe("live");
    expect(classifyFreshness(now - 10 * 60_000, now)).toBe("live");
    expect(classifyFreshness(now - 11 * 60_000, now)).toBe("recent");
    expect(classifyFreshness(now - 23 * 3_600_000, now)).toBe("recent");
    expect(classifyFreshness(now - 25 * 3_600_000, now)).toBe("silent");
    expect(classifyFreshness(null, now)).toBe("silent");
  });
  it("reads the catalogue's build-time sighting as at most recent", () => {
    expect(freshnessFromCatalog("2026-09-27T18:00:00Z", now)).toBe("recent");
    expect(freshnessFromCatalog("2026-09-20T18:00:00Z", now)).toBe("silent");
    expect(freshnessFromCatalog(null, now)).toBe("silent");
  });
  it("gives a Raspberry Shake an hour to count as live, and no other service", () => {
    // Its public archive runs ~30 min behind real time (measured 2026-10-21).
    expect(RASPBERRY_SHAKE_LIVE_MAX_AGE_MS).toBe(60 * 60_000);
    expect(liveMaxAgeMs("raspberryshake")).toBe(60 * 60_000);
    for (const service of ["earthscope", "koeri", "geofon"] as const) {
      expect(liveMaxAgeMs(service)).toBe(LIVE_MAX_AGE_MS);
      expect(LIVE_MAX_AGE_MS).toBe(10 * 60_000);
    }
    const shake = liveMaxAgeMs("raspberryshake");
    expect(classifyFreshness(now - 30 * 60_000, now, shake)).toBe("live");
    expect(classifyFreshness(now - 60 * 60_000, now, shake)).toBe("live");
    expect(classifyFreshness(now - 61 * 60_000, now, shake)).toBe("recent");
    expect(classifyFreshness(now - 25 * 3_600_000, now, shake)).toBe("silent");
    // The same 30-minute delay is "Delayed" for the other services.
    expect(classifyFreshness(now - 30 * 60_000, now, liveMaxAgeMs("earthscope"))).toBe(
      "recent",
    );
  });
});
