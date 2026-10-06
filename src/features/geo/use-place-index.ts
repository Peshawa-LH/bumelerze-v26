import { useEffect, useState } from "react";

import { getLoadedPlaceIndex, loadPlaceIndex } from "./place-index";
import type { PlaceIndex } from "./place-search";

/** The search index, or null for the few milliseconds it takes to load. */
export function usePlaceIndex(): PlaceIndex | null {
  const [index, setIndex] = useState<PlaceIndex | null>(() => getLoadedPlaceIndex());
  useEffect(() => {
    if (index) {
      return;
    }
    let cancelled = false;
    void loadPlaceIndex().then((loaded) => {
      if (!cancelled) {
        setIndex(loaded);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [index]);
  return index;
}
