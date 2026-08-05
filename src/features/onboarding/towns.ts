/**
 * HomeBase town picker list (spec-v1.md §4.11 step 5, wave brief point 1).
 * ~20 Kurdistan-region towns, bundled with the app — no map, no geocoding
 * service, no network call. Coordinates are approximate town centroids,
 * good enough for Phase 4's eventual "is this event near HomeBase" math;
 * this wave only stores them (v1 feed never shows HomeBase distance).
 *
 * Upgrade path (leave for whoever builds Phase 3 MapLibre): once the map is
 * in, replace this static list with a map-pin placement UI that still
 * writes the same `HomeBasePreference` shape (townId can become a
 * synthetic "custom-pin" id) — no store/schema change needed then.
 */
export interface HomeBaseTown {
  id: string;
  /** i18n key for the display name — never a hard-coded city string. */
  nameKey: string;
  lat: number;
  lon: number;
}

export const HOME_BASE_TOWNS: readonly HomeBaseTown[] = [
  { id: "erbil", nameKey: "onboarding.homeBase.towns.erbil", lat: 36.19, lon: 44.01 },
  { id: "slemani", nameKey: "onboarding.homeBase.towns.slemani", lat: 35.56, lon: 45.43 },
  { id: "duhok", nameKey: "onboarding.homeBase.towns.duhok", lat: 36.87, lon: 42.99 },
  { id: "kirkuk", nameKey: "onboarding.homeBase.towns.kirkuk", lat: 35.47, lon: 44.39 },
  { id: "halabja", nameKey: "onboarding.homeBase.towns.halabja", lat: 35.18, lon: 45.98 },
  { id: "zakho", nameKey: "onboarding.homeBase.towns.zakho", lat: 37.14, lon: 42.68 },
  { id: "soran", nameKey: "onboarding.homeBase.towns.soran", lat: 36.65, lon: 44.54 },
  { id: "ranya", nameKey: "onboarding.homeBase.towns.ranya", lat: 36.25, lon: 44.89 },
  { id: "koya", nameKey: "onboarding.homeBase.towns.koya", lat: 36.08, lon: 44.63 },
  { id: "kalar", nameKey: "onboarding.homeBase.towns.kalar", lat: 34.62, lon: 45.32 },
  {
    id: "chamchamal",
    nameKey: "onboarding.homeBase.towns.chamchamal",
    lat: 35.53,
    lon: 44.83,
  },
  { id: "akre", nameKey: "onboarding.homeBase.towns.akre", lat: 36.75, lon: 43.89 },
  {
    id: "bardarash",
    nameKey: "onboarding.homeBase.towns.bardarash",
    lat: 36.5,
    lon: 43.55,
  },
  { id: "dukan", nameKey: "onboarding.homeBase.towns.dukan", lat: 35.95, lon: 44.95 },
  {
    id: "darbandikhan",
    nameKey: "onboarding.homeBase.towns.darbandikhan",
    lat: 35.13,
    lon: 45.72,
  },
  {
    id: "khanaqin",
    nameKey: "onboarding.homeBase.towns.khanaqin",
    lat: 34.36,
    lon: 45.39,
  },
  { id: "mosul", nameKey: "onboarding.homeBase.towns.mosul", lat: 36.34, lon: 43.13 },
  { id: "baghdad", nameKey: "onboarding.homeBase.towns.baghdad", lat: 33.31, lon: 44.36 },
];

/** Sentinel id for "elsewhere" — a free skip, never geocoded, never present
 * in `HOME_BASE_TOWNS` above. Selecting it stores `homeBase: null`. */
export const HOME_BASE_ELSEWHERE_ID = "elsewhere";
