import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Appearance preference (owner, 2026-09-27: "in Settings ... 3 buttons:
 * Automatic (the default, follows the system) or manually Light / Dark").
 * Same small-dedicated-store shape as `features/map/preferences-store.ts` —
 * one concern per store keeps each `persist` migration story simple. The
 * default, "auto", reproduces today's behavior exactly (`useTheme` already
 * just read `useColorScheme()`), so there is no first-launch flicker to
 * guard against the way the map style pick needed `hasHydrated` gating
 * before first paint: until this store hydrates, "auto" is already the
 * right answer.
 */
export type ThemePreference = "auto" | "light" | "dark";

export const THEME_PREFERENCES: readonly ThemePreference[] = ["auto", "light", "dark"];

export interface ThemePreferencesState {
  preference: ThemePreference;
  hasHydrated: boolean;
  setPreference: (preference: ThemePreference) => void;
  setHasHydrated: (value: boolean) => void;
}

export const useThemePreferencesStore = create<ThemePreferencesState>()(
  persist(
    (set) => ({
      preference: "auto",
      hasHydrated: false,
      setPreference: (preference) => set({ preference }),
      setHasHydrated: (value) => set({ hasHydrated: value }),
    }),
    {
      name: "bumelerze.theme-preferences",
      storage: createJSONStorage(() => AsyncStorage),
      // Only `preference` is meaningful across launches — `hasHydrated` and
      // the actions are runtime-only.
      partialize: (state) => ({ preference: state.preference }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
