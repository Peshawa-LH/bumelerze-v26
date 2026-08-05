import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Prefs store (wave brief point 2) — the app's first true client-state need,
 * so per typescript-react-native.md this is zustand, not React Query (that
 * stays reserved for server state) and not Redux.
 */

export type OnboardingStepId =
  "mission" | "language" | "location" | "notifications" | "homeBase" | "done";

/** Screen order per spec-v1.md §4.11 — also drives the progress dots and the
 * resume-after-restart lookup (routes.ts), so it's the one place that order
 * is written down. */
export const ONBOARDING_STEPS: readonly OnboardingStepId[] = [
  "mission",
  "language",
  "location",
  "notifications",
  "homeBase",
  "done",
];

export interface HomeBasePreference {
  townId: string;
  /** Null only for the "elsewhere" sentinel town — every real town in
   * towns.ts always carries coordinates. */
  lat: number | null;
  lon: number | null;
}

export interface PrefsState {
  onboardingCompleted: boolean;
  /** Furthest onboarding screen the user has reached. Exists so a forced
   * app reload mid-onboarding (the language screen's RTL-flip restart is
   * the only thing that triggers one) can resume exactly where the user
   * left off instead of restarting the whole flow (wave brief: "must
   * survive the restart and RESUME onboarding, not restart it"). */
  onboardingStep: OnboardingStepId;
  homeBase: HomeBasePreference | null;
  /** True once the persisted values have finished loading from
   * AsyncStorage. The root layout renders nothing until this flips, so it
   * never flashes Home before onboarding, or onboarding before Home
   * (wave brief: "no flicker — gate on store hydration"). */
  hasHydrated: boolean;
  setOnboardingStep: (step: OnboardingStepId) => void;
  completeOnboarding: () => void;
  setHomeBase: (homeBase: HomeBasePreference | null) => void;
  /** Settings' "replay onboarding" row — per spec-v1.md §4.11 ("not
   * reachable after") this is the *only* path back into onboarding once
   * it's been completed once. */
  resetOnboarding: () => void;
  setHasHydrated: (value: boolean) => void;
}

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      onboardingCompleted: false,
      onboardingStep: "mission",
      homeBase: null,
      hasHydrated: false,
      setOnboardingStep: (step) => set({ onboardingStep: step }),
      completeOnboarding: () =>
        set({ onboardingCompleted: true, onboardingStep: "done" }),
      setHomeBase: (homeBase) => set({ homeBase }),
      resetOnboarding: () =>
        set({ onboardingCompleted: false, onboardingStep: "mission" }),
      setHasHydrated: (value) => set({ hasHydrated: value }),
    }),
    {
      name: "bumelerze.prefs",
      storage: createJSONStorage(() => AsyncStorage),
      // Only these three are meaningful across launches; hydration flag and
      // actions are runtime-only and would be pointless (or wrong) to persist.
      partialize: (state) => ({
        onboardingCompleted: state.onboardingCompleted,
        onboardingStep: state.onboardingStep,
        homeBase: state.homeBase,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
