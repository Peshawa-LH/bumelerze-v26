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

/** "homeBase" stays in the id type only so a step saved by an older version
 * still resumes (it routes to "done"): the town-picker step left the flow
 * (owner, 2026-10-04) and the whole concept left the UI (2026-10-06).
 *
 * Screen order per spec-v1.md §4.11 — also drives the progress dots and the
 * resume-after-restart lookup (routes.ts), so it's the one place that order
 * is written down. */
export const ONBOARDING_STEPS: readonly OnboardingStepId[] = [
  "mission",
  "language",
  "location",
  "notifications",
  "done",
];

/** A place the app remembers: its search id and where it is. The id is a
 * gazetteer id ("erbil") or an OSM-derived id from the place search. */
export interface StoredPlace {
  placeId: string;
  lat: number;
  lon: number;
}

/** Where the reference place came from: the device location ("auto", the
 * default, refreshed daily) or a place the reader chose by hand ("manual",
 * never overwritten by the location check). */
export type ReferenceSource = "auto" | "manual";

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
/** Tier a freshly chosen "another place" starts with: someone who bothers to
 * add a place for family elsewhere almost always wants to hear about it. */
const DEFAULT_ANOTHER_PLACE_TIER: NotificationTier = "all";

export interface PrefsState {
  onboardingCompleted: boolean;
  /** Furthest onboarding screen the user has reached. Exists so a forced
   * app reload mid-onboarding (the language screen's RTL-flip restart is
   * the only thing that triggers one) can resume exactly where the user
   * left off instead of restarting the whole flow (wave brief: "must
   * survive the restart and RESUME onboarding, not restart it"). */
  onboardingStep: OnboardingStepId;
  /**
   * The reader's place, shown on My account as "My location": the nearest
   * main town to the last location fix, else Hawler, unless the reader chose
   * one by hand. Also the default for places that must be pre-selected (the
   * felt report without GPS, the Tag my building pin's starting point).
   */
  referencePlace: StoredPlace | null;
  /** "auto" follows the device location; "manual" is the reader's own choice
   * and is never overwritten by the location check. */
  referenceSource: ReferenceSource;
  /** True when the last location check had a valid fix but no main town was
   * within range (a reader abroad); false when a town was in range. Only the
   * wording on My account uses it: `referencePlace` stays as the silent
   * fallback for pre-fills. Missing in an older saved blob reads as false (the
   * store's defaults fill it), so no persist version bump was needed. */
  referenceOutOfRange: boolean;
  /** UTC ms of the last reference-place check; null = never. Throttles the
   * location lookup to once a day. */
  referenceCheckedAt: number | null;
  /**
   * Alert preset tier for events near the user's current/last-known
   * location (spec-v1.md §4.10). Default 'm3' — matches D16's
   * fatigue-aware stance of not paging everyone for M<3 background
   * seismicity while still catching everything locally felt-worthy.
   *
   * CLIENT preference only (no push token, no server call yet). Server
   * subscription sync attaches HERE: once anonymous auth is wired, a future
   * effect reads `nearMeTier` / `anotherPlace` / `anotherPlaceTier` and
   * upserts them into `notification_subscriptions.near_me_tier` and
   * `homebase_tier` / `homebase_lat` / `homebase_lon` (migration 0005). The
   * server columns keep their old names; the client model is the same: one
   * optional extra place with a tier.
   */
  nearMeTier: NotificationTier;
  /** The optional "Also alert me about another place" (for family elsewhere).
   * Null = off. Chosen with the place search. */
  anotherPlace: StoredPlace | null;
  /** Alert tier for `anotherPlace`, evaluated independently of where the
   * user is. 'off' whenever there is no place; 'all' when one is first
   * chosen, and a later change of place keeps whatever tier was picked. */
  anotherPlaceTier: NotificationTier;
  /** The Home "Be ready" card (a link to the Safety guide) is hidden for good:
   * the reader dismissed it or opened the Safety guide once (D79). */
  beReadyHidden: boolean;
  /** True once the persisted values have finished loading from
   * AsyncStorage. The root layout renders nothing until this flips, so it
   * never flashes Home before onboarding, or onboarding before Home
   * (wave brief: "no flicker — gate on store hydration"). */
  hasHydrated: boolean;
  setOnboardingStep: (step: OnboardingStepId) => void;
  completeOnboarding: () => void;
  /** Stores the location-derived reference place and when it was checked.
   * A no-op while the reader's own choice (manual) is in place. */
  setReferencePlace: (place: StoredPlace, checkedAt: number) => void;
  /** The reader picks a place by hand: it becomes the reference place and
   * the location check stops replacing it. */
  chooseReferencePlace: (place: StoredPlace) => void;
  /** Back to following the device location. Clears the last-check time so
   * the next refresh runs immediately. (Not named `use…`: it is a plain
   * action, not a React hook.) */
  resumeAutoReference: () => void;
  /** Records whether the last valid fix was outside every town's range. */
  setReferenceOutOfRange: (outOfRange: boolean) => void;
  /** Records a check that found nothing to change. */
  markReferenceChecked: (checkedAt: number) => void;
  /** Sets or clears the optional extra alert place. */
  setAnotherPlace: (place: StoredPlace | null) => void;
  setNearMeTier: (tier: NotificationTier) => void;
  setAnotherPlaceTier: (tier: NotificationTier) => void;
  /** Settings' "replay onboarding" row — per spec-v1.md §4.11 ("not
   * reachable after") this is the *only* path back into onboarding once
   * it's been completed once. */
  resetOnboarding: () => void;
  /** Hides the Home "Be ready" card for good. */
  hideBeReady: () => void;
  setHasHydrated: (value: boolean) => void;
}

/** Persist schema version. 0 = the HomeBase model (`homeBase`, `homeBaseSource`,
 * `homeBaseAutoCheckedAt`, `homeBaseTier`); 1 = reference place + another
 * place; 2 = adds `referenceSource` (auto | manual); 3 = adds `beReadyHidden`. */
export const PREFS_VERSION = 3;

function isNotificationTier(value: unknown): value is NotificationTier {
  return NOTIFICATION_TIERS.includes(value as NotificationTier);
}

function readStoredPlace(value: unknown): StoredPlace | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as {
    townId?: unknown;
    placeId?: unknown;
    lat?: unknown;
    lon?: unknown;
  };
  const id = candidate.placeId ?? candidate.townId;
  if (
    typeof id !== "string" ||
    typeof candidate.lat !== "number" ||
    typeof candidate.lon !== "number"
  ) {
    // The old "elsewhere" sentinel had null coordinates: no place.
    return null;
  }
  return { placeId: id, lat: candidate.lat, lon: candidate.lon };
}

/**
 * Persist migration, run as a chain (0 to 1, 1 to 2, then 2 to 3).
 *
 * Version 2 to 3: the Home "Be ready" card exists from now on, so every
 * existing install starts with it visible (`beReadyHidden` false). The Safety
 * tab left the tab bar in this release; the card is how people find it again.
 *
 * Version 1 to 2: every existing reference place was filled by the location
 * check (or the Hawler fallback), so it is "auto".
 *
 * Version 0 to 1, from the HomeBase model:
 * - a HomeBase the user picked by hand (source "manual", a real town) becomes
 *   their "another place", keeping the alert tier they had; it also stays as
 *   the background reference until the next location check replaces it;
 * - an automatic HomeBase becomes just the background reference, with no
 *   extra place;
 * - "elsewhere" (a manual HomeBase of null) means no extra place;
 * - installs older than the tier/source fields are read with the rules those
 *   fields used to derive (a saved town was a manual choice, tier "all").
 * Fields that are not about places pass through untouched.
 */
export function migratePrefs(
  persisted: unknown,
  fromVersion: number,
): Partial<PrefsState> {
  if (
    fromVersion >= PREFS_VERSION ||
    typeof persisted !== "object" ||
    persisted === null
  ) {
    return (persisted ?? {}) as Partial<PrefsState>;
  }
  let migrated = persisted as Record<string, unknown>;
  if (fromVersion < 1) {
    migrated = migrateHomeBaseToReference(migrated);
  }
  if (fromVersion < 2) {
    migrated = { ...migrated, referenceSource: migrated.referenceSource ?? "auto" };
  }
  if (fromVersion < 3) {
    migrated = { ...migrated, beReadyHidden: migrated.beReadyHidden ?? false };
  }
  return migrated as Partial<PrefsState>;
}

function migrateHomeBaseToReference(
  old: Record<string, unknown>,
): Record<string, unknown> {
  const { homeBase, homeBaseSource, homeBaseAutoCheckedAt, homeBaseTier, ...rest } = old;

  const town = readStoredPlace(homeBase);
  const source = homeBaseSource ?? (homeBase ? "manual" : "auto");
  const oldTier = isNotificationTier(homeBaseTier)
    ? homeBaseTier
    : DEFAULT_ANOTHER_PLACE_TIER;

  const migrated: Record<string, unknown> = { ...rest };
  migrated.referencePlace = town;
  migrated.referenceCheckedAt = null;
  if (source === "manual" && town) {
    migrated.anotherPlace = town;
    migrated.anotherPlaceTier = oldTier;
  } else {
    migrated.anotherPlace = null;
    migrated.anotherPlaceTier = "off";
    if (source === "auto") {
      migrated.referenceCheckedAt =
        typeof homeBaseAutoCheckedAt === "number" ? homeBaseAutoCheckedAt : null;
    }
  }
  return migrated;
}

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      onboardingCompleted: false,
      onboardingStep: "mission",
      referencePlace: null,
      referenceSource: "auto",
      referenceOutOfRange: false,
      referenceCheckedAt: null,
      nearMeTier: DEFAULT_NEAR_ME_TIER,
      anotherPlace: null,
      anotherPlaceTier: "off",
      beReadyHidden: false,
      hasHydrated: false,
      setOnboardingStep: (step) => set({ onboardingStep: step }),
      completeOnboarding: () =>
        set({ onboardingCompleted: true, onboardingStep: "done" }),
      setReferencePlace: (place, checkedAt) =>
        set((state) =>
          state.referenceSource === "manual"
            ? {}
            : { referencePlace: place, referenceCheckedAt: checkedAt },
        ),
      chooseReferencePlace: (place) =>
        set({ referencePlace: place, referenceSource: "manual" }),
      resumeAutoReference: () =>
        set({ referenceSource: "auto", referenceCheckedAt: null }),
      setReferenceOutOfRange: (referenceOutOfRange) => set({ referenceOutOfRange }),
      markReferenceChecked: (checkedAt) => set({ referenceCheckedAt: checkedAt }),
      setAnotherPlace: (anotherPlace) =>
        set((state) => ({
          anotherPlace,
          // Only a first choice (or a removal) touches the tier; swapping one
          // place for another keeps the tier the user picked.
          anotherPlaceTier:
            anotherPlace === null
              ? "off"
              : state.anotherPlace === null
                ? DEFAULT_ANOTHER_PLACE_TIER
                : state.anotherPlaceTier,
        })),
      setNearMeTier: (tier) => set({ nearMeTier: tier }),
      setAnotherPlaceTier: (tier) => set({ anotherPlaceTier: tier }),
      resetOnboarding: () =>
        set({ onboardingCompleted: false, onboardingStep: "mission" }),
      hideBeReady: () => set({ beReadyHidden: true }),
      setHasHydrated: (value) => set({ hasHydrated: value }),
    }),
    {
      name: "bumelerze.prefs",
      version: PREFS_VERSION,
      migrate: (persisted, version) => migratePrefs(persisted, version) as PrefsState,
      storage: createJSONStorage(() => AsyncStorage),
      // Only these fields are meaningful across launches; hydration flag and
      // actions are runtime-only and would be pointless (or wrong) to persist.
      partialize: (state) => ({
        onboardingCompleted: state.onboardingCompleted,
        onboardingStep: state.onboardingStep,
        referencePlace: state.referencePlace,
        referenceSource: state.referenceSource,
        referenceOutOfRange: state.referenceOutOfRange,
        referenceCheckedAt: state.referenceCheckedAt,
        nearMeTier: state.nearMeTier,
        anotherPlace: state.anotherPlace,
        anotherPlaceTier: state.anotherPlaceTier,
        beReadyHidden: state.beReadyHidden,
      }),
      // `persistedState` is `undefined` on a first-ever launch; the migration
      // has already run for older blobs, so this only fills what is missing.
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<PrefsState>;
        return { ...currentState, ...persisted };
      },
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
