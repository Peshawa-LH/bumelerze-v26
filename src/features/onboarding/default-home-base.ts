import { usePrefsStore } from "./store";
import { HOME_BASE_TOWNS } from "./towns";

/** The HomeBase used when location isn't allowed (owner, 2026-10-05). */
export const DEFAULT_HOME_BASE_TOWN_ID = "erbil";

/**
 * Gives an install without location a HomeBase: Erbil. Kept "auto", so the
 * nearest town replaces it as soon as location is allowed; never touches a
 * HomeBase that is already set, or a person's own choice (including
 * "somewhere else", which is a manual null).
 */
export function applyDefaultHomeBase(): void {
  const state = usePrefsStore.getState();
  if (state.homeBase !== null || state.homeBaseSource !== "auto") {
    return;
  }
  const town = HOME_BASE_TOWNS.find(
    (candidate) => candidate.id === DEFAULT_HOME_BASE_TOWN_ID,
  );
  if (!town) {
    return;
  }
  usePrefsStore.setState({
    homeBase: { townId: town.id, lat: town.lat, lon: town.lon },
    homeBaseSource: "auto",
    homeBaseAutoCheckedAt: null,
  });
}
