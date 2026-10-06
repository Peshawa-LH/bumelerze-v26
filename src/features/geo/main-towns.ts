import { GAZETTEER_CITIES, type GazetteerCityNames } from "./gazetteer";

/**
 * The ~18 main towns of Kurdistan and its neighbours, drawn from the one
 * bundled gazetteer. Used as the place search's quick picks when there is no
 * location fix, as the candidates for the background reference place, and as
 * the priority cities on the shakemap. Deliberately a subset of the gazetteer:
 * most of it (Iran/Turkey border towns, extra Iraqi reference points) exists
 * for event place lines, not as places a reader would pick first.
 */
export interface MainTown {
  id: string;
  names: GazetteerCityNames;
  lat: number;
  lon: number;
}

const MAIN_TOWN_IDS = [
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

export const MAIN_TOWNS: readonly MainTown[] = MAIN_TOWN_IDS.map((id) => {
  const city = GAZETTEER_CITIES.find((candidate) => candidate.id === id);
  if (!city) {
    // Fails fast at module load (dev-time only) if a gazetteer id above is
    // ever renamed or removed without updating this list.
    throw new Error(`Main town "${id}" is missing from the gazetteer`);
  }
  return { id: city.id, lat: city.lat, lon: city.lon, names: city.names };
});

/** Hawler: the silent fallback when no location is known (owner, 2026-10-05). */
export const DEFAULT_PLACE_ID = "erbil";
