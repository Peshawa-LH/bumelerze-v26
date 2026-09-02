import {
  HOME_FEED_MAGNITUDE_FLOOR_STEPS,
  HOME_FEED_MAX_CARDS,
  HOME_FEED_MIN_CARDS,
  HOME_FEED_MIN_MAGNITUDE,
  HOME_FEED_WINDOW_STEPS_DAYS,
} from "../config";
import { selectHomeFeedEvents } from "../home-feed-policy";
import type { Event } from "../types";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

function makeEvent(
  id: string,
  overrides: Partial<Pick<Event, "originTime" | "isRegional">> & { mag?: number } = {},
): Event {
  return {
    id,
    bumelerzeId: null,
    originTime: overrides.originTime ?? NOW - 5 * 60_000,
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
    isRegional: overrides.isRegional ?? true,
    url: `https://example.test/${id}`,
  };
}

describe("selectHomeFeedEvents", () => {
  it("keeps the baseline window and baseline floor when the baseline already meets the minimum card count", () => {
    // 5 events inside the baseline (30d) window at/above the baseline
    // floor — exactly HOME_FEED_MIN_CARDS, so the sparse ladder stops
    // immediately at the baseline step; a 6th below-floor event is still
    // excluded, same as the existing display floor's shipped behavior.
    const pool = [
      makeEvent("a", { originTime: NOW - 1 * DAY_MS, mag: 4.6 }),
      makeEvent("b", { originTime: NOW - 2 * DAY_MS, mag: 3.1 }),
      makeEvent("c", { originTime: NOW - 3 * DAY_MS, mag: 3.2 }),
      makeEvent("d", { originTime: NOW - 4 * DAY_MS, mag: 3.3 }),
      makeEvent("e", { originTime: NOW - 5 * DAY_MS, mag: 3.4 }),
      makeEvent("below-floor", { originTime: NOW - 1 * DAY_MS, mag: 1.8 }),
    ];

    const result = selectHomeFeedEvents(pool, NOW);

    expect(result.windowDays).toBe(HOME_FEED_WINDOW_STEPS_DAYS[0]);
    expect(result.magnitudeFloor).toBe(HOME_FEED_MIN_MAGNITUDE);
    expect(result.events.map((e) => e.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(result.notableIds.size).toBe(0);
  });

  it("widens the window when a small feed (below HOME_FEED_MIN_CARDS) has older-but-plausible activity available, rather than leaving Home looking empty", () => {
    const pool = [makeEvent("a", { mag: 4.6 }), makeEvent("b", { mag: 3.1 })];

    const result = selectHomeFeedEvents(pool, NOW);

    // Only 2 cards at every window step (both events are "just now") — the
    // ladder climbs all the way to the 180-day cap looking for more, never
    // fabricating cards that don't exist.
    expect(result.windowDays).toBe(180);
    expect(result.events.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("SPARSE: widens the lookback window step by step when the baseline window is too empty", () => {
    // Only 2 events inside the 30-day baseline window (below
    // HOME_FEED_MIN_CARDS), but 6 total once the window widens to 90 days —
    // enough to clear the minimum at the 90-day step.
    const pool = [
      makeEvent("recent-1", { originTime: NOW - 1 * DAY_MS, mag: 3.5 }),
      makeEvent("recent-2", { originTime: NOW - 2 * DAY_MS, mag: 3.2 }),
      makeEvent("older-1", { originTime: NOW - 45 * DAY_MS, mag: 3.1 }),
      makeEvent("older-2", { originTime: NOW - 50 * DAY_MS, mag: 3.3 }),
      makeEvent("older-3", { originTime: NOW - 70 * DAY_MS, mag: 3.4 }),
      makeEvent("older-4", { originTime: NOW - 80 * DAY_MS, mag: 3.0 }),
    ];

    const result = selectHomeFeedEvents(pool, NOW);

    expect(result.windowDays).toBe(90);
    expect(result.magnitudeFloor).toBe(HOME_FEED_MIN_MAGNITUDE);
    expect(result.events).toHaveLength(6);
  });

  it("SPARSE: caps at the widest window step (180d) and never fabricates cards when even the widest window stays under the minimum", () => {
    const pool = [makeEvent("only-one", { originTime: NOW - 100 * DAY_MS, mag: 3.5 })];

    const result = selectHomeFeedEvents(pool, NOW);

    expect(result.windowDays).toBe(180);
    expect(result.events.map((e) => e.id)).toEqual(["only-one"]);
  });

  it("DENSE: tightens the magnitude floor stepwise instead of shortening the window when the feed is overclogged", () => {
    // 50 events at M3.0-3.4 (over HOME_FEED_MAX_CARDS at the baseline
    // floor) all within the 30-day baseline window, plus a handful at
    // M3.5+ and M4.0+ so tightening actually trims the list.
    const pool: Event[] = [];
    for (let i = 0; i < 50; i += 1) {
      pool.push(makeEvent(`noise-${i}`, { originTime: NOW - i * 60_000, mag: 3.1 }));
    }
    for (let i = 0; i < 10; i += 1) {
      pool.push(makeEvent(`mid-${i}`, { originTime: NOW - i * 60_000, mag: 3.6 }));
    }
    for (let i = 0; i < 5; i += 1) {
      pool.push(makeEvent(`big-${i}`, { originTime: NOW - i * 60_000, mag: 4.2 }));
    }

    const result = selectHomeFeedEvents(pool, NOW);

    // Window is NEVER shortened to fix a dense feed — stays at baseline.
    expect(result.windowDays).toBe(HOME_FEED_WINDOW_STEPS_DAYS[0]);
    // 15 events clear M3.5 (10 mid + 5 big) — at or under the 40-card max,
    // so the floor settles at the second rung, not the strictest.
    expect(result.magnitudeFloor).toBe(3.5);
    expect(result.events).toHaveLength(15);
    expect(result.events.every((e) => e.magnitude.value >= 3.5)).toBe(true);
  });

  it("DENSE: climbs to the strictest floor rung when even M4.0 is still over the max", () => {
    const pool: Event[] = [];
    for (let i = 0; i < 60; i += 1) {
      pool.push(makeEvent(`huge-${i}`, { originTime: NOW - i * 60_000, mag: 5.0 }));
    }

    const result = selectHomeFeedEvents(pool, NOW);

    expect(result.magnitudeFloor).toBe(
      HOME_FEED_MAGNITUDE_FLOOR_STEPS[HOME_FEED_MAGNITUDE_FLOOR_STEPS.length - 1],
    );
    expect(result.events).toHaveLength(60);
  });

  it("NOTABLE CARVE-OUT: a 4-month-old M5.5 event survives outside the normal window/floor and is flagged notable", () => {
    const fourMonthsAgoMs = 122 * DAY_MS; // ~4 months, well past the 90d step
    // 5 fresh events keep the sparse ladder from widening past the 30-day
    // baseline (they already meet HOME_FEED_MIN_CARDS on their own) — this
    // isolates the notable carve-out from the sparse-widen mechanism, which
    // would otherwise also reach a 122-day-old event on a near-empty pool.
    const pool = [
      makeEvent("fresh-1", { originTime: NOW - 1 * DAY_MS, mag: 3.2 }),
      makeEvent("fresh-2", { originTime: NOW - 2 * DAY_MS, mag: 3.3 }),
      makeEvent("fresh-3", { originTime: NOW - 3 * DAY_MS, mag: 3.1 }),
      makeEvent("fresh-4", { originTime: NOW - 4 * DAY_MS, mag: 3.4 }),
      makeEvent("fresh-5", { originTime: NOW - 5 * DAY_MS, mag: 3.0 }),
      makeEvent("old-big", { originTime: NOW - fourMonthsAgoMs, mag: 5.5 }),
    ];

    const result = selectHomeFeedEvents(pool, NOW);

    expect(result.windowDays).toBe(HOME_FEED_WINDOW_STEPS_DAYS[0]);
    const ids = result.events.map((e) => e.id);
    expect(ids).toContain("fresh-1");
    expect(ids).toContain("old-big");
    expect(result.notableIds.has("old-big")).toBe(true);
    expect(result.notableIds.has("fresh-1")).toBe(false);
  });

  it("NOTABLE CARVE-OUT: an M6+ event just under 12 months old survives even though it's well past the 180-day window cap", () => {
    const elevenMonthsAgoMs = 335 * DAY_MS;
    const pool = [makeEvent("year-old-big", { originTime: NOW - elevenMonthsAgoMs, mag: 6.2 })];

    const result = selectHomeFeedEvents(pool, NOW);

    expect(result.events.map((e) => e.id)).toEqual(["year-old-big"]);
    expect(result.notableIds.has("year-old-big")).toBe(true);
  });

  it("NOTABLE CARVE-OUT: an M5.9 event past its 6-month tier (but not the M6+ 12-month tier) is correctly excluded", () => {
    const sevenMonthsAgoMs = 213 * DAY_MS;
    const pool = [makeEvent("too-old-for-its-tier", { originTime: NOW - sevenMonthsAgoMs, mag: 5.9 })];

    const result = selectHomeFeedEvents(pool, NOW);

    expect(result.events).toHaveLength(0);
    expect(result.notableIds.size).toBe(0);
  });

  it("DEDUP: the same event id appearing twice in the input pool (region + notable-tail overlap) renders once", () => {
    const event = makeEvent("dup-1", { mag: 4.0 });
    const pool = [event, { ...event }];

    const result = selectHomeFeedEvents(pool, NOW);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.id).toBe("dup-1");
  });

  it("ORDERING: the merged list (adaptive selection + notable carve-out) is sorted strictly newest-first", () => {
    const fourMonthsAgoMs = 122 * DAY_MS;
    const pool = [
      makeEvent("yesterday", { originTime: NOW - 1 * DAY_MS, mag: 3.2 }),
      makeEvent("old-notable", { originTime: NOW - fourMonthsAgoMs, mag: 5.5 }),
      makeEvent("today", { originTime: NOW - 1 * 60_000, mag: 3.0 }),
    ];

    const result = selectHomeFeedEvents(pool, NOW);

    expect(result.events.map((e) => e.id)).toEqual(["today", "yesterday", "old-notable"]);
    for (let i = 1; i < result.events.length; i += 1) {
      const previous = result.events[i - 1];
      const current = result.events[i];
      expect(previous).toBeDefined();
      expect(current).toBeDefined();
      if (previous && current) {
        expect(previous.originTime).toBeGreaterThanOrEqual(current.originTime);
      }
    }
  });

  it("ignores non-regional events defensively (Home is a region-first screen)", () => {
    const pool = [
      makeEvent("regional", { mag: 4.0, isRegional: true }),
      makeEvent("world", { mag: 7.0, isRegional: false }),
    ];

    const result = selectHomeFeedEvents(pool, NOW);

    expect(result.events.map((e) => e.id)).toEqual(["regional"]);
  });

  it("respects HOME_FEED_MIN_CARDS/HOME_FEED_MAX_CARDS as the actual thresholds driving the widen/tighten ladders (sanity check on the tunable constants themselves)", () => {
    expect(HOME_FEED_MIN_CARDS).toBeGreaterThan(0);
    expect(HOME_FEED_MAX_CARDS).toBeGreaterThan(HOME_FEED_MIN_CARDS);
    expect(HOME_FEED_WINDOW_STEPS_DAYS[0]).toBe(30);
    expect(HOME_FEED_WINDOW_STEPS_DAYS.at(-1)).toBe(180);
    expect(HOME_FEED_MAGNITUDE_FLOOR_STEPS[0]).toBe(HOME_FEED_MIN_MAGNITUDE);
  });
});
