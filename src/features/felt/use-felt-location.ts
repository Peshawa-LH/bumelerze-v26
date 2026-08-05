import { useMemo, useState } from "react";

import { useUserDistanceAnchor } from "@/features/location";
import { HOME_BASE_TOWNS, usePrefsStore } from "@/features/onboarding";
import type { FeltLocation } from "./types";

/** Region-capital fallback when neither a GPS fix nor a HomeBase town exists
 * — spec-v1.md §4.6: the manual picker "never blocks submission", so a real
 * town is always preselected even before the user touches anything. */
const DEFAULT_MANUAL_TOWN_ID = "erbil";

export interface UseFeltLocationResult {
  location: FeltLocation;
  /** True when the GPS fix supplied the location (no manual picker shown). */
  isGps: boolean;
  /** Meaningful only when `!isGps` — current inline-picker selection and
   * setter. Always a real town id, never a state that would block
   * submission. */
  manualTownId: string;
  setManualTownId: (townId: string) => void;
}

/**
 * Resolves the location to attach to a felt report (spec-v1.md §4.6): a GPS
 * fix if permission is already granted (read-only check, reused from
 * `features/location` — never itself prompts, matching that hook's own
 * no-surprise-prompt contract), else the user's HomeBase town, else a
 * sensible default town — always inline, always resolved synchronously
 * enough that tier 1's one-tap submission is never blocked waiting on it.
 */
export function useFeltLocation(): UseFeltLocationResult {
  const userFix = useUserDistanceAnchor();
  const homeBase = usePrefsStore((state) => state.homeBase);
  // `homeBase.lat` is null only for the "elsewhere" sentinel (see
  // features/onboarding/store.ts) — that case falls through to the default
  // town below rather than a non-geocoded id the picker can't resolve.
  const defaultManualTownId =
    homeBase && homeBase.lat !== null ? homeBase.townId : DEFAULT_MANUAL_TOWN_ID;
  const [manualTownId, setManualTownId] = useState(defaultManualTownId);

  const location = useMemo<FeltLocation>(() => {
    if (userFix.hasFix) {
      return { quality: "gps", lat: userFix.lat, lon: userFix.lon };
    }

    const town =
      HOME_BASE_TOWNS.find((candidate) => candidate.id === manualTownId) ??
      HOME_BASE_TOWNS[0];
    if (!town) {
      // Unreachable in practice (HOME_BASE_TOWNS is a fixed non-empty
      // bundled list) — satisfies noUncheckedIndexedAccess without ever
      // silently producing a report with no location.
      throw new Error("useFeltLocation: HOME_BASE_TOWNS is unexpectedly empty");
    }
    return { quality: "manual", lat: town.lat, lon: town.lon, townId: town.id };
  }, [userFix, manualTownId]);

  return { location, isGps: userFix.hasFix, manualTownId, setManualTownId };
}
