/**
 * Map scope — Kurdistan (regional, default) vs. World (global) marker
 * source (update-plan-2026-08.md §4.1: "a switchable option, maybe
 * 'Kurdistan' and 'World'... when pressed switches between showing all
 * events in Kurdistan... and all events around the world"). Kurdistan stays
 * the default per the region-first principle (D11/D26).
 *
 * This module only holds the pure scope identity + the world fit-viewport
 * bbox — WHICH event array backs each scope is decided by the caller
 * (`useRegionEvents`/`useWorldEvents`, both already-existing data sources,
 * no new fetching per the wave brief).
 */
import type { RegionBbox } from "./marker-helpers";

export type MapScope = "kurdistan" | "world";

/** Display order also drives the toggle's rendered order — Kurdistan first,
 * matching its default/primary status. */
export const MAP_SCOPES: readonly MapScope[] = ["kurdistan", "world"];

export const DEFAULT_MAP_SCOPE: MapScope = "kurdistan";

/**
 * World-view fit bbox — deliberately narrower than the full
 * [-180,-90]..[180,90] globe extent. `fitBounds` on a full-globe bbox tends
 * to over-zoom-out on typical phone aspect ratios and wastes screen space on
 * the empty polar caps; this bbox comfortably frames every populated
 * seismic region the World feed's M4.5+ USGS summary actually reports
 * events in (`usgs.ts`'s `fetchUsgsWorldEvents`), while still reading as
 * "the whole world" at a glance. Same `{minLat,maxLat,minLon,maxLon}` shape
 * as `marker-helpers.ts`'s `RegionBbox`/`REGION_BBOX`, so
 * `regionBboxToLngLatBounds` handles both without a second conversion path.
 */
export const WORLD_VIEW_BBOX: RegionBbox = {
  minLat: -58,
  maxLat: 75,
  minLon: -175,
  maxLon: 178,
};
