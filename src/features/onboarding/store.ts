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

/**
 * Preset alert tiers (Phase 4, spec-v1.md §4.10/D11) — matches
 * `supabase/migrations/0005_notifications_and_telemetry.sql`'s
 * `near_me_tier`/`homebase_tier` check-constraint values exactly
 * ('off'|'all'|'m3'|'m4'|'m5'), so a future sync layer can write these
 * strings straight into that row with no translation step.
 */
export type NotificationTier = "off" | "all" | "m3" | "m4" | "m5";

export const NOTIFICATION_TIERS: readonly NotificationTier[] = [
  "off",
  "all",
  "m3",
  "m4",
  "m5",
];

const DEFAULT_NEAR_ME_TIER: NotificationTier = "m3";
const DEFAULT_HOME_BASE_TIER_WITH_TOWN: NotificationTier = "all";
const DEFAULT_HOME_BASE_TIER_WITHOUT_TOWN: NotificationTier = "off";

export interface PrefsState {
  onboardingCompleted: boolean;
  /** Furthest onboarding screen the user has reached. Exists so a forced
   * app reload mid-onboarding (the language screen's RTL-flip restart is
   * the only thing that triggers one) can resume exactly where the user
   * left off instead of restarting the whole flow (wave brief: "must
   * survive the restart and RESUME onboarding, not restart it"). */
  onboardingStep: OnboardingStepId;
  homeBase: HomeBasePreference | null;
  /**
   * Alert preset tier for events near the user's current/last-known
   * location (spec-v1.md §4.10). Default 'm3' — matches D16's
   * fatigue-aware stance of not paging everyone for M<3 background
   * seismicity while still catching everything locally felt-worthy.
   *
   * CLIENT preference only this wave (Phase 4) — no push token, no
   * server call. Server subscription sync attaches HERE: once anonymous
   * auth is wired (see supabase/README.md's Anonymous Auth note), a
   * future effect reads `nearMeTier`/`homeBaseTier` and upserts them into
   * `notification_subscriptions.near_me_tier`/`homebase_tier`
   * (migration 0005) alongside the Expo push token and the near-me/
   * HomeBase lat/lon columns that table already has room for.
   */
  nearMeTier: NotificationTier;
  /**
   * Alert preset tier for the HomeBase pin, evaluated independently of
   * the user's own location (spec-v1.md §4.10/D11, J3). Default logic
   * (documented here since it's a derived default, not a flat constant):
   * 'all' once a HomeBase town is set (a diaspora user who bothers to set
   * a HomeBase almost always wants to hear about it), else 'off' (a tier
   * with no location to evaluate against is meaningless). Applied once,
   * at first-set time, via `setHomeBase`'s migration path below and the
   * v1 store default — changing HomeBase afterward does NOT silently
   * overwrite a tier the user has since customized.
   */
  homeBaseTier: NotificationTier;
  /** True once the persisted values have finished loading from
   * AsyncStorage. The root layout renders nothing until this flips, so it
   * never flashes Home before onboarding, or onboarding before Home
   * (wave brief: "no flicker — gate on store hydration"). */
  hasHydrated: boolean;
  setOnboardingStep: (step: OnboardingStepId) => void;
  completeOnboarding: () => void;
  setHomeBase: (homeBase: HomeBasePreference | null) => void;
  setNearMeTier: (tier: NotificationTier) => void;
  setHomeBaseTier: (tier: NotificationTier) => void;
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
      nearMeTier: DEFAULT_NEAR_ME_TIER,
      homeBaseTier: DEFAULT_HOME_BASE_TIER_WITHOUT_TOWN,
      hasHydrated: false,
      setOnboardingStep: (step) => set({ onboardingStep: step }),
      completeOnboarding: () =>
        set({ onboardingCompleted: true, onboardingStep: "done" }),
      setHomeBase: (homeBase) =>
        set((state) => ({
          homeBase,
          // Derived-default rule (see homeBaseTier's doc comment above):
          // only auto-set the tier when a HomeBase is being established for
          // the first time (previous value was null) or cleared entirely —
          // switching from one town to another keeps whatever tier the user
          // already chose.
          homeBaseTier:
            homeBase === null
              ? DEFAULT_HOME_BASE_TIER_WITHOUT_TOWN
              : state.homeBase === null
                ? DEFAULT_HOME_BASE_TIER_WITH_TOWN
                : state.homeBaseTier,
        })),
      setNearMeTier: (tier) => set({ nearMeTier: tier }),
      setHomeBaseTier: (tier) => set({ homeBaseTier: tier }),
      resetOnboarding: () =>
        set({ onboardingCompleted: false, onboardingStep: "mission" }),
      setHasHydrated: (value) => set({ hasHydrated: value }),
    }),
    {
      name: "bumelerze.prefs",
      storage: createJSONStorage(() => AsyncStorage),
      // Only these fields are meaningful across launches; hydration flag and
      // actions are runtime-only and would be pointless (or wrong) to persist.
      partialize: (state) => ({
        onboardingCompleted: state.onboardingCompleted,
        onboardingStep: state.onboardingStep,
        homeBase: state.homeBase,
        nearMeTier: state.nearMeTier,
        homeBaseTier: state.homeBaseTier,
      }),
      // Custom merge (rather than the default shallow-spread) so installs
      // that already had `homeBase` persisted BEFORE Phase 4 added the tier
      // fields land on the correct derived default instead of the flat
      // "off" initial-state value — an existing diaspora user with a
      // HomeBase already set should not silently start with alerts off.
      // Fresh installs are unaffected: `persistedState` is `{}` for them, so
      // both branches below are no-ops and the create()-time defaults stand.
      merge: (persistedState, currentState) => {
        // `persistedState` is `undefined` on a first-ever launch (nothing in
        // AsyncStorage yet) — zustand's persist middleware calls `merge`
        // unconditionally either way, so this must tolerate that case
        // rather than assume a real object.
        const persisted = (persistedState ?? {}) as Partial<PrefsState>;
        const merged: PrefsState = { ...currentState, ...persisted };
        if (persisted.homeBaseTier === undefined) {
          merged.homeBaseTier = merged.homeBase
            ? DEFAULT_HOME_BASE_TIER_WITH_TOWN
            : DEFAULT_HOME_BASE_TIER_WITHOUT_TOWN;
        }
        if (persisted.nearMeTier === undefined) {
          merged.nearMeTier = DEFAULT_NEAR_ME_TIER;
        }
        return merged;
      },
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
