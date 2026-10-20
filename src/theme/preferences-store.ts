import AsyncStorage from "@react-native-async-storage/async-storage";
import { Appearance, Platform } from "react-native";
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
        applySystemAppearance(state?.preference ?? "auto");
      },
    },
  ),
);

/**
 * iOS/Android: the system parts of the app (alerts, the keyboard, the share
 * sheet, pickers, menus) follow Settings > Appearance as well, not only the
 * app's own colours. `useColorScheme` then reports the chosen scheme, which
 * `useTheme` resolves the same way. "auto" hands it back to the system. The
 * web does this through the document's `color-scheme`
 * (`applyDocumentColorSchemeWeb`).
 */
export function applySystemAppearance(preference: ThemePreference): void {
  if (Platform.OS === "web") {
    return;
  }
  try {
    Appearance.setColorScheme(preference === "auto" ? "unspecified" : preference);
  } catch {
    // Older native modules without an override: the app colours still follow.
  }
}

useThemePreferencesStore.subscribe((state, previous) => {
  if (state.preference !== previous.preference) {
    applySystemAppearance(state.preference);
  }
});
