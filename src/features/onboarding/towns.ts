import { GAZETTEER_CITIES, type GazetteerCityNames } from "@/features/geo";

/**
 * HomeBase town picker list (spec-v1.md §4.11 step 5, wave brief point 1).
 * Wave 5 (ui-backlog.md item 3) relocated the actual town data into
 * `features/geo`'s bundled gazetteer — this module is now just a curated
 * *subset* (the same ~18 towns this picker has always shown) drawn from
 * that single dataset, per PROJECT.md's gotcha against scattering more than
 * one town/city list through the app. `names` carries all four locale
 * spellings directly from the gazetteer (draft-machine, see
 * `features/geo/gazetteer.ts`'s doc comment) instead of an i18n key, since
 * the gazetteer is the source of truth for place names now.
 *
 * Upgrade path (leave for whoever builds Phase 3 MapLibre): once the map is
 * in, replace this static list with a map-pin placement UI that still
 * writes the same `HomeBasePreference` shape (townId can become a
 * synthetic "custom-pin" id) — no store/schema change needed then.
 */
export interface HomeBaseTown {
  id: string;
  names: GazetteerCityNames;
  lat: number;
  lon: number;
}

/** The original onboarding town subset (spec-v1.md §4.11), by gazetteer id
 * — deliberately not "every gazetteer city", since most of the gazetteer
 * (Iran/Turkey border towns, extra Iraqi reference points) exists for
 * event place-lines, not as HomeBase choices for someone living in or near
 * Kurdistan. */
const HOME_BASE_TOWN_IDS = [
  "erbil",
  "slemani",
  "duhok",
  "kirkuk",
  "halabja",
  "zakho",
  "soran",
  "ranya",
  "koya",
  "kalar",
  "chamchamal",
  "akre",
  "bardarash",
  "dukan",
  "darbandikhan",
  "khanaqin",
  "mosul",
  "baghdad",
] as const;

export const HOME_BASE_TOWNS: readonly HomeBaseTown[] = HOME_BASE_TOWN_IDS.map((id) => {
  const city = GAZETTEER_CITIES.find((candidate) => candidate.id === id);
  if (!city) {
    // Fails fast at module load (dev-time only) if a gazetteer id above is
    // ever renamed/removed without updating this list.
    throw new Error(`HomeBase town "${id}" is missing from the gazetteer`);
  }
  return { id: city.id, lat: city.lat, lon: city.lon, names: city.names };
});

/** Sentinel id for "elsewhere" — a free skip, never geocoded, never present
 * in `HOME_BASE_TOWNS` above. Selecting it stores `homeBase: null`. */
export const HOME_BASE_ELSEWHERE_ID = "elsewhere";
