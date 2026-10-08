import type { Event } from "@/features/events";

import {
  EXPECTED_INTENSITY_V_TABLE,
  MANUAL_WINDOW_MS,
  QUIET_PERIOD_MS,
} from "../constants";
import {
  eventKey,
  expectedAtLeastV,
  feltPromptKind,
  pickBannerEvent,
  pickManualEvent,
  type PromptMemory,
} from "../relevance";

const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
const HOUR = 3_600_000;
// Halabja-ish phone fix; one degree of latitude is about 111 km.
const FIX = { lat: 35.18, lon: 45.98 };

function event(
  id: string,
  magnitude: number,
  kmNorth: number,
  ageMs: number,
  regional = true,
): Event {
  return {
    id,
    bumelerzeId: null,
    originTime: NOW - ageMs,
    lat: FIX.lat + kmNorth / 111.2,
    lon: FIX.lon,
    depthKm: 10,
    magnitude: { value: magnitude, type: "mww" },
    placeName: "somewhere",
    provenance: {
      provider: "usgs",
      providerId: id,
      fetchedAt: NOW,
      providerUpdatedAt: NOW,
    },
    sig: 0,
    isRegional: regional,
    url: "",
  };
}

const EMPTY: PromptMemory = { handled: {}, lastAction: null };

describe("expected intensity >= V table (owner-confirmed bar)", () => {
  it("is the design note's table, strongest first", () => {
    expect(EXPECTED_INTENSITY_V_TABLE.map((r) => [r.minMagnitude, r.withinKm])).toEqual([
      [7.0, 400],
      [6.5, 250],
      [6.0, 150],
      [5.5, 80],
      [5.0, 40],
      [4.5, 20],
    ]);
  });

  it.each(EXPECTED_INTENSITY_V_TABLE.map((r) => [r.minMagnitude, r.withinKm]))(
    "M%s qualifies up to %s km and not beyond",
    (magnitude, km) => {
      expect(expectedAtLeastV(magnitude, km)).toBe(true);
      expect(expectedAtLeastV(magnitude, km + 0.1)).toBe(false);
    },
  );

  it("below M4.5 never qualifies; just under a row falls to the row below", () => {
    expect(expectedAtLeastV(4.4, 0)).toBe(false);
    expect(expectedAtLeastV(4.99, 30)).toBe(false);
    expect(expectedAtLeastV(4.99, 20)).toBe(true);
    expect(expectedAtLeastV(5.4, 60)).toBe(false);
  });

  it("rejects nonsense input", () => {
    expect(expectedAtLeastV(Number.NaN, 1)).toBe(false);
    expect(expectedAtLeastV(6, -1)).toBe(false);
  });
});

describe("felt-report prompt", () => {
  it("V and up: primary; III-IV: quiet; I-II and none: nothing", () => {
    expect([1, 2, 3, 4, 5, 6, 12].map(feltPromptKind)).toEqual([
      "none",
      "none",
      "quiet",
      "quiet",
      "primary",
      "primary",
      "primary",
    ]);
    expect(feltPromptKind(null)).toBe("none");
    expect(feltPromptKind(undefined)).toBe("none");
  });
});

describe("Home banner event", () => {
  it("asks about a strong, near, recent event", () => {
    const e = event("a", 5.2, 30, HOUR);
    expect(pickBannerEvent([e], FIX, EMPTY, NOW)?.id).toBe("a");
  });

  it("needs a fix; too far, too old or in the future: nothing", () => {
    expect(pickBannerEvent([event("a", 5.2, 30, HOUR)], null, EMPTY, NOW)).toBeNull();
    expect(pickBannerEvent([event("a", 5.2, 60, HOUR)], FIX, EMPTY, NOW)).toBeNull();
    expect(pickBannerEvent([event("a", 5.2, 30, 7 * HOUR)], FIX, EMPTY, NOW)).toBeNull();
    expect(pickBannerEvent([event("a", 5.2, 30, -HOUR)], FIX, EMPTY, NOW)).toBeNull();
  });

  it("never asks twice for an answered event", () => {
    const e = event("a", 5.2, 30, HOUR);
    expect(
      pickBannerEvent(
        [e],
        FIX,
        { handled: { [eventKey(e)]: NOW }, lastAction: null },
        NOW,
      ),
    ).toBeNull();
  });

  it("stays quiet for 3 hours after an answer unless an event is clearly stronger", () => {
    const memory: PromptMemory = {
      handled: {},
      lastAction: { at: NOW - HOUR, magnitude: 5.0 },
    };
    expect(pickBannerEvent([event("b", 5.3, 10, HOUR / 2)], FIX, memory, NOW)).toBeNull();
    expect(pickBannerEvent([event("c", 5.5, 10, HOUR / 2)], FIX, memory, NOW)?.id).toBe(
      "c",
    );
    const later: PromptMemory = {
      handled: {},
      lastAction: { at: NOW - QUIET_PERIOD_MS - 1, magnitude: 5.0 },
    };
    expect(pickBannerEvent([event("b", 5.3, 10, HOUR / 2)], FIX, later, NOW)?.id).toBe(
      "b",
    );
  });

  it("picks the strongest, then the newest", () => {
    const picked = pickBannerEvent(
      [
        event("a", 5.0, 10, 2 * HOUR),
        event("b", 6.1, 100, 3 * HOUR),
        event("c", 6.1, 10, HOUR),
      ],
      FIX,
      EMPTY,
      NOW,
    );
    expect(picked?.id).toBe("c");
  });

  it("makes no network call (the position never leaves the phone)", () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("no network expected");
    });
    pickBannerEvent([event("a", 5.2, 30, HOUR)], FIX, EMPTY, NOW);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("manual check-in event", () => {
  it("newest regional M4.0+ of the last 72 hours", () => {
    const picked = pickManualEvent(
      [
        event("old", 6, 0, MANUAL_WINDOW_MS + 1),
        event("small", 3.9, 0, HOUR),
        event("abroad", 5, 0, HOUR, false),
        event("ok1", 4.0, 0, 10 * HOUR),
        event("ok2", 4.6, 0, 5 * HOUR),
      ],
      NOW,
    );
    expect(picked?.id).toBe("ok2");
  });

  it("none: practice", () => {
    expect(pickManualEvent([event("small", 3.5, 0, HOUR)], NOW)).toBeNull();
    expect(pickManualEvent([], NOW)).toBeNull();
  });
});
