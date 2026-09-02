import type { Event } from "@/features/events";
import {
  computeDateBoundsMs,
  computeMagnitudeBounds,
  filterEventsByMagnitudeAndDate,
  isDateRangeNarrowed,
  isMagnitudeRangeNarrowed,
} from "../filters";

const NOW = Date.UTC(2026, 7, 17, 12, 0, 0);

function makeEvent(id: string, overrides: { mag?: number; originTime?: number } = {}): Event {
  return {
    id,
    bumelerzeId: null,
    originTime: overrides.originTime ?? NOW,
    lat: 35.56,
    lon: 45.43,
    depthKm: 10,
    magnitude: { value: overrides.mag ?? 4.0, type: "mb" },
    placeName: "test place",
    provenance: {
      provider: "usgs",
      providerId: id,
      fetchedAt: NOW,
      providerUpdatedAt: NOW,
    },
    sig: 400,
    isRegional: true,
    url: `https://example.test/${id}`,
  };
}

describe("computeMagnitudeBounds", () => {
  it("returns a fixed fallback span for an empty event set", () => {
    expect(computeMagnitudeBounds([])).toEqual({ min: 0, max: 7 });
  });

  it("rounds outward to the nearest half-magnitude step, never clipping a real event", () => {
    const events = [makeEvent("a", { mag: 3.14 }), makeEvent("b", { mag: 5.81 })];
    expect(computeMagnitudeBounds(events)).toEqual({ min: 3, max: 6 });
  });

  it("keeps a non-zero span even when every event rounds to the same step", () => {
    const events = [makeEvent("a", { mag: 4.0 }), makeEvent("b", { mag: 4.1 })];
    const bounds = computeMagnitudeBounds(events);
    expect(bounds.max).toBeGreaterThan(bounds.min);
  });

  it("adapts to the World scope's higher natural floor (M4.5+ feed) rather than a fixed constant", () => {
    const worldEvents = [makeEvent("a", { mag: 4.6 }), makeEvent("b", { mag: 6.9 })];
    expect(computeMagnitudeBounds(worldEvents)).toEqual({ min: 4.5, max: 7 });
  });
});

describe("computeDateBoundsMs", () => {
  it("falls back to a one-day window ending now for an empty event set", () => {
    expect(computeDateBoundsMs([], NOW)).toEqual({
      startMs: NOW - 24 * 60 * 60 * 1000,
      endMs: NOW,
    });
  });

  it("spans from the oldest event's origin time to now, not the newest event's time", () => {
    const oldest = NOW - 10 * 24 * 60 * 60 * 1000;
    const events = [
      makeEvent("a", { originTime: oldest }),
      makeEvent("b", { originTime: NOW - 60_000 }),
    ];
    expect(computeDateBoundsMs(events, NOW)).toEqual({ startMs: oldest, endMs: NOW });
  });
});

describe("filterEventsByMagnitudeAndDate", () => {
  const events = [
    makeEvent("low", { mag: 2.9, originTime: NOW - 1000 }),
    makeEvent("atMin", { mag: 3.0, originTime: NOW - 1000 }),
    makeEvent("mid", { mag: 4.5, originTime: NOW - 1000 }),
    makeEvent("atMax", { mag: 6.0, originTime: NOW - 1000 }),
    makeEvent("high", { mag: 6.1, originTime: NOW - 1000 }),
    makeEvent("tooOld", { mag: 4.5, originTime: NOW - 100_000 }),
    makeEvent("atStart", { mag: 4.5, originTime: NOW - 50_000 }),
    makeEvent("atEnd", { mag: 4.5, originTime: NOW }),
    makeEvent("future", { mag: 4.5, originTime: NOW + 1000 }),
  ];
  const magnitudeRange = { min: 3.0, max: 6.0 };
  const dateRange = { startMs: NOW - 50_000, endMs: NOW };

  it("includes events exactly on either magnitude boundary (inclusive both ends)", () => {
    const ids = filterEventsByMagnitudeAndDate(events, magnitudeRange, dateRange).map(
      (e) => e.id,
    );
    expect(ids).toContain("atMin");
    expect(ids).toContain("atMax");
    expect(ids).not.toContain("low");
    expect(ids).not.toContain("high");
  });

  it("includes events exactly on either date boundary (inclusive both ends)", () => {
    const ids = filterEventsByMagnitudeAndDate(events, magnitudeRange, dateRange).map(
      (e) => e.id,
    );
    expect(ids).toContain("atStart");
    expect(ids).toContain("atEnd");
    expect(ids).not.toContain("tooOld");
    expect(ids).not.toContain("future");
  });

  it("returns every event unfiltered when the range equals the full bounds", () => {
    const bounds = computeMagnitudeBounds(events);
    const dates = computeDateBoundsMs(events, NOW + 1000);
    const result = filterEventsByMagnitudeAndDate(events, bounds, dates);
    expect(result).toHaveLength(events.length);
  });
});

describe("isMagnitudeRangeNarrowed / isDateRangeNarrowed", () => {
  it("is false when the range exactly equals the bounds", () => {
    expect(isMagnitudeRangeNarrowed({ min: 3, max: 7 }, { min: 3, max: 7 })).toBe(false);
    expect(
      isDateRangeNarrowed({ startMs: 0, endMs: 100 }, { startMs: 0, endMs: 100 }),
    ).toBe(false);
  });

  it("is true when either end is narrower than the bounds", () => {
    expect(isMagnitudeRangeNarrowed({ min: 3.5, max: 7 }, { min: 3, max: 7 })).toBe(true);
    expect(isMagnitudeRangeNarrowed({ min: 3, max: 6 }, { min: 3, max: 7 })).toBe(true);
    expect(
      isDateRangeNarrowed({ startMs: 10, endMs: 100 }, { startMs: 0, endMs: 100 }),
    ).toBe(true);
    expect(
      isDateRangeNarrowed({ startMs: 0, endMs: 90 }, { startMs: 0, endMs: 100 }),
    ).toBe(true);
  });
});
