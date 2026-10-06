import { GAZETTEER_CITIES } from "./gazetteer";
import { parseKurdishPlaces } from "./kurdish-places";
import { buildPlaceIndex, type PlaceIndex } from "./place-search";

/** Metro's dynamic import yields a namespace whose `.default` is the JSON
 * array; Jest's CommonJS interop can hand back the array itself. */
function unwrapJson(mod: unknown): unknown {
  return Array.isArray(mod) ? mod : (mod as { default?: unknown }).default;
}

let cached: PlaceIndex | null = null;
let pending: Promise<PlaceIndex> | null = null;

/**
 * Loads the bundled datasets and builds the search index, once. The village
 * list (the bulk of the data) comes in through a dynamic import, so a session
 * that never opens a place search never pays to parse it, the same way the
 * Map tab loads it. Resolves instantly after the first call.
 */
export function loadPlaceIndex(): Promise<PlaceIndex> {
  if (cached) {
    return Promise.resolve(cached);
  }
  pending ??= Promise.all([
    import("./data/kurdish-places-core.json"),
    import("./data/kurdish-places-villages.json"),
  ]).then(([core, villages]) => {
    cached = buildPlaceIndex({
      cities: GAZETTEER_CITIES,
      towns: parseKurdishPlaces(unwrapJson(core)),
      villages: parseKurdishPlaces(unwrapJson(villages)),
    });
    return cached;
  });
  return pending;
}

/** The index when it has already been loaded, else null. */
export function getLoadedPlaceIndex(): PlaceIndex | null {
  return cached;
}

export function __resetPlaceIndexForTests(): void {
  cached = null;
  pending = null;
}
