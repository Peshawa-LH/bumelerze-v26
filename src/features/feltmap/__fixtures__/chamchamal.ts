import { encodeGeohash } from "@/lib/felt-aggregation";
import type { FeltCellRow } from "../types";

/**
 * Golden felt-map fixture: ~15 cells clustered around Chamchamal
 * (35.53, 44.83 — `features/geo/gazetteer.ts`'s `"chamchamal"` entry), the
 * same area named in the real missed-earthquake case study
 * `events/merge.ts` documents ("2026-08-13 22:28 UTC, M4.0 mb, Iran–Iraq
 * border region"). Used by `FeltMapView`'s golden render test and the
 * Event-Detail integration test; NOT a claim about that real event's actual
 * felt-report data (Bumelerze had no backend live on 2026-08-13) — a
 * plausible synthetic decay pattern (CDI highest near the assumed
 * epicenter, falling off with distance) built for deterministic test/
 * preview coverage, per the wave brief's "realistic golden fixture"
 * request.
 *
 * `event_id` is deliberately NOT shaped like a real USGS/EMSC id (compare
 * `"us2000bmcg"`, `"20260813_e1"` elsewhere in this codebase's fixtures) —
 * prefixed `fixture-` so it can never be mistaken for a real provider event
 * if it ever leaked outside a test/preview context.
 */
export const FELTMAP_FIXTURE_EVENT_ID = "fixture-chamchamal-20260813";

export const CHAMCHAMAL_CENTER = { lat: 35.53, lon: 44.83 };

/** `[deltaLat, deltaLon, cdi, nReports]` — degree offsets from
 * `CHAMCHAMAL_CENTER`, roughly one p5 cell-width (~0.045°) apart, CDI
 * decaying outward from the assumed epicenter (mixed 2.2-6.0, within the
 * wave brief's "mixed CDI 2-6" request), report counts 3-40 (also per the
 * brief). All p5 (base display precision) — the separate precision-nesting
 * behavior (p4/p6 superseding) already has dedicated coverage in
 * `__tests__/cell-selection.test.ts`, so this golden fixture stays single-
 * precision for a simple, stable golden render. */
const OFFSETS: readonly [number, number, number, number][] = [
  [0, 0, 6.0, 40],
  [0.045, 0, 5.3, 28],
  [-0.045, 0, 5.1, 25],
  [0, 0.05, 5.4, 30],
  [0, -0.05, 5.0, 22],
  [0.045, 0.05, 4.6, 18],
  [0.045, -0.05, 4.4, 16],
  [-0.045, 0.05, 4.5, 17],
  [-0.045, -0.05, 4.2, 14],
  [0.09, 0, 3.5, 10],
  [-0.09, 0, 3.3, 9],
  [0, 0.1, 3.6, 11],
  [0, -0.1, 3.2, 8],
  [0.09, 0.1, 2.5, 5],
  [-0.09, -0.1, 2.2, 3],
];

const COMPUTED_AT = "2026-08-14T03:00:00.000Z";

export const CHAMCHAMAL_FELT_MAP_FIXTURE: FeltCellRow[] = OFFSETS.map(
  ([deltaLat, deltaLon, cdi, nReports]) => {
    const lat = CHAMCHAMAL_CENTER.lat + deltaLat;
    const lon = CHAMCHAMAL_CENTER.lon + deltaLon;
    return {
      event_id: FELTMAP_FIXTURE_EVENT_ID,
      geohash: encodeGeohash(lat, lon, 5),
      precision: 5,
      n_reports: nReports,
      n_tier2: Math.max(1, Math.round(nReports * 0.3)),
      cdi,
      version: 1,
      computed_at: COMPUTED_AT,
    };
  },
);
