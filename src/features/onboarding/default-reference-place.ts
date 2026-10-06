import { DEFAULT_PLACE_ID, MAIN_TOWNS } from "@/features/geo/main-towns";
import { usePrefsStore } from "./store";

/**
 * Gives an install without a location a silent reference place: Hawler (owner,
 * 2026-10-05). The nearest town replaces it as soon as location is allowed.
 * Never touches a reference place that is already set.
 */
export function applyDefaultReferencePlace(): void {
  const state = usePrefsStore.getState();
  if (state.referencePlace !== null) {
    return;
  }
  const town = MAIN_TOWNS.find((candidate) => candidate.id === DEFAULT_PLACE_ID);
  if (!town) {
    return;
  }
  usePrefsStore.setState({
    referencePlace: { placeId: town.id, lat: town.lat, lon: town.lon },
    referenceCheckedAt: null,
  });
}
