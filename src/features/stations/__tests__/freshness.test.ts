import { classifyFreshness, freshnessFromCatalog } from "../freshness";

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
});
