import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { DEFAULT_MAP_STYLE_CATALOG_ID, type MapStyleCatalogId } from "./style-catalog";

/**
 * Map-tab client preferences — today just the basemap style pick
 * (update-plan-2026-08.md §4.3/Part 3: "Persist his choice locally so it
 * survives reloads"). A small dedicated store rather than folding into
 * `onboarding/store.ts`'s `usePrefsStore` — that store's `partialize`/
 * `merge` are already tightly scoped to onboarding + notification-tier
 * fields (typescript-react-native.md: zustand for true client state, one
 * concern per store keeps each `persist` migration story simple).
 *
 * Same hydration-gate shape as `onboarding/store.ts`'s `hasHydrated`: the
 * persisted style pick loads from `AsyncStorage` asynchronously (a
 * same-tick-ish microtask on web, where this store is actually read), so
 * `map.web.tsx`'s map-creation effect waits for `hasHydrated` before
 * resolving its initial style — otherwise a returning user who picked
 * `dataviz` last session would see one frame (or one full map
 * construction) of the `outdoor` default before their real choice loads.
 */
export interface MapPreferencesState {
  styleId: MapStyleCatalogId;
  hasHydrated: boolean;
  setStyleId: (styleId: MapStyleCatalogId) => void;
  setHasHydrated: (value: boolean) => void;
}

export const useMapPreferencesStore = create<MapPreferencesState>()(
  persist(
    (set) => ({
      styleId: DEFAULT_MAP_STYLE_CATALOG_ID,
      hasHydrated: false,
      setStyleId: (styleId) => set({ styleId }),
      setHasHydrated: (value) => set({ hasHydrated: value }),
    }),
    {
      name: "bumelerze.map-preferences",
      storage: createJSONStorage(() => AsyncStorage),
      // Only `styleId` is meaningful across launches — `hasHydrated` and the
      // actions are runtime-only.
      partialize: (state) => ({ styleId: state.styleId }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
