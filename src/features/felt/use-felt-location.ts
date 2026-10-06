import { useMemo, useState } from "react";

import { DEFAULT_PLACE_ID, gazetteerPlaceById, type Place } from "@/features/geo";
import { useUserDistanceAnchor } from "@/features/location";
import { usePrefsStore } from "@/features/onboarding";
import type { FeltLocation } from "./types";

export interface UseFeltLocationResult {
  location: FeltLocation;
  /** True when the GPS fix supplied the location (no manual picker shown). */
  isGps: boolean;
  /** Meaningful only when `!isGps` — the place picked (or pre-selected) in
   * the inline place search. Always a real place, never a state that would
   * block submission. */
  manualPlace: Place;
  setManualPlace: (place: Place) => void;
}

/**
 * Resolves the location to attach to a felt report (spec-v1.md §4.6): a GPS
 * fix if permission is already granted (read-only check, reused from
 * `features/location` — never itself prompts, matching that hook's own
 * no-surprise-prompt contract), else a place the reader picks with the place
 * search. That place starts as the silent background reference place (the
 * nearest main town to the last fix, else Hawler), so tier 1's one-tap
 * submission is never blocked waiting on a choice. Only lat/lon and the
 * "manual" quality are uploaded; the place id is local bookkeeping.
 */
export function useFeltLocation(): UseFeltLocationResult {
  const userFix = useUserDistanceAnchor();
  const referencePlace = usePrefsStore((state) => state.referencePlace);
  const [manualPlace, setManualPlace] = useState<Place>(
    () =>
      (referencePlace ? gazetteerPlaceById(referencePlace.placeId) : null) ??
      gazetteerPlaceById(DEFAULT_PLACE_ID) ??
      FALLBACK_PLACE,
  );

  const location = useMemo<FeltLocation>(() => {
    if (userFix.hasFix) {
      return { quality: "gps", lat: userFix.lat, lon: userFix.lon };
    }
    return {
      quality: "manual",
      lat: manualPlace.lat,
      lon: manualPlace.lon,
      placeId: manualPlace.id,
    };
  }, [userFix, manualPlace]);

  return { location, isGps: userFix.hasFix, manualPlace, setManualPlace };
}

/** Unreachable in practice (Hawler is in the bundled gazetteer); keeps the
 * state non-null so a report is never created without a location. */
const FALLBACK_PLACE: Place = {
  id: DEFAULT_PLACE_ID,
  kind: "city",
  lat: 36.19,
  lon: 44.01,
  names: { en: "Hawler" },
};
