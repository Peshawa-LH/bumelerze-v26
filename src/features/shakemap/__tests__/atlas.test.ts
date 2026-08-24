/**
 * Bumelerze Atlas bundle sync-check (D21): `atlas/index.ts` is GENERATED
 * (`bumelerze-engine/scripts/bundle_atlas_for_app.py`) from
 * `bumelerze-engine/bumelerze-atlas/`, itself seeded
 * (`bumelerze-engine/scripts/seed_atlas.py`) from the exact same curated list
 * this test imports directly — `NOTABLE_HISTORICAL_EVENTS`
 * (`src/features/historical/notable-events.ts`). This test is the app-side
 * half of that sync guarantee: if the curated list ever changes without
 * re-running the two Python generators, this test catches the drift
 * immediately (never a silently stale Atlas bundle).
 */

import { NOTABLE_HISTORICAL_EVENTS } from "@/features/historical";
import { ATLAS_EVENT_IDS, ATLAS_INDEX } from "../atlas";
import { parseIntensityContours } from "../contours";

describe("Bumelerze Atlas bundle", () => {
  it("has exactly one bundled entry per curated historical event id — no more, no fewer", () => {
    const curatedIds = NOTABLE_HISTORICAL_EVENTS.map((e) => e.id).sort();
    const bundledIds = [...ATLAS_EVENT_IDS].sort();
    expect(bundledIds).toEqual(curatedIds);
  });

  it("every bundled entry's raw contours parse cleanly into at least one intensity level", () => {
    for (const eventId of ATLAS_EVENT_IDS) {
      const entry = ATLAS_INDEX[eventId];
      expect(entry).toBeTruthy();
      const contours = parseIntensityContours(entry!.contours);
      expect(contours.levels.length).toBeGreaterThan(0);
    }
  });

  it("every bundled entry carries a real producer/version/reviewStatus/dataUsedSummaryKey", () => {
    const validReviewStatuses = new Set(["automatic", "reviewed"]);
    const validDataUsedKeys = new Set([
      "catalogOnly",
      "stationConditioned",
      "dyfiConditioned",
      "stationAndDyfiConditioned",
    ]);

    for (const eventId of ATLAS_EVENT_IDS) {
      const entry = ATLAS_INDEX[eventId]!;
      expect(entry.producer).toBe("bumelerze");
      expect(entry.version).toBeGreaterThanOrEqual(1);
      expect(validReviewStatuses.has(entry.reviewStatus)).toBe(true);
      expect(validDataUsedKeys.has(entry.dataUsedSummaryKey)).toBe(true);
      expect(entry.eventId).toBe(eventId);
      expect(Number.isNaN(Date.parse(entry.generatedAt))).toBe(false);
    }
  });
});
