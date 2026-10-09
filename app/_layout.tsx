// Side-effect import, web no-op on native: self-heal reload when a stale
// cached page requests lazy chunks a newer deploy removed (see the module).
import "@/lib/web-chunk-reload";

import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Stack, useSegments } from "expo-router";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SnackbarProvider, TAB_BAR_CONTENT_HEIGHT } from "@/components/Snackbar";
import { useStackScreenOptions } from "@/components/use-stack-screen-options";
import {
  createEventsPersister,
  createEventsQueryClient,
  PERSISTED_CACHE_MAX_AGE_MS,
} from "@/features/events/queries";
import {
  ensureHomePhotoQueueForegroundSync,
  processHomePhotoQueue,
} from "@/features/building/photo-queue";
import {
  ensureFeedbackQueueForegroundSync,
  processFeedbackQueue,
} from "@/features/feedback";
import {
  ensureFeltQueueForegroundSync,
  processQueue,
  reconcileSubmittedReports,
} from "@/features/felt";
import { useAlertPrefsAutoSync } from "@/features/alerts/prefs-sync";
import { useReferencePlace } from "@/features/location";
import { usePrefsStore } from "@/features/onboarding";
import { touchPresenceOnce } from "@/features/presence";
import { ensureCheckInForegroundSync, processCheckInQueue } from "@/features/safe/queue";
import { sendColdStartTelemetryPing } from "@/features/telemetry";
import { useTabBarStore } from "@/features/tab-bar";
import { useLaunchPendingTour } from "@/features/tour";
import { shouldPersistQuery } from "@/lib/persist-filter";
// Side effect: initializes i18next before the first render, in addition to
// the named import below.
import { applyPersistedLocaleOnLaunch } from "@/i18n";
import { restartApp } from "@/i18n/restart-app";
import { applyDocumentColorSchemeWeb, useTheme } from "@/theme";

// Created once per app instance (module scope, not per render) so the
// persisted cache round-trips through the SAME client across re-renders —
// creating a new QueryClient on every render would defeat the persister
// (offline/cold-start requirement, PROJECT.md).
const eventsQueryClient = createEventsQueryClient();
const eventsPersister = createEventsPersister();

export default function RootLayout() {
  const { scheme } = useTheme();
  const stackScreenOptions = useStackScreenOptions();
  // Vazirmatn for Arabic-script locales (`src/theme/typography.ts`'s
  // `ARABIC_SCRIPT_FONT`). Not awaited: text renders in the fallback face
  // until the file is in, then re-renders — better than a blank first
  // paint on a weak connection.
  useFonts({
    "Vazirmatn-Regular": require("../assets/fonts/Vazirmatn-Regular.ttf"),
    "Vazirmatn-Medium": require("../assets/fonts/Vazirmatn-Medium.ttf"),
    "Vazirmatn-SemiBold": require("../assets/fonts/Vazirmatn-SemiBold.ttf"),
    "Vazirmatn-Bold": require("../assets/fonts/Vazirmatn-Bold.ttf"),
  });
  // A snackbar sits above the tab bar on the tab screens and at the bottom
  // edge elsewhere.
  const segments = useSegments();
  const inTabs = (segments as string[])[0] === "(tabs)";
  // The scroll-aware tab bar takes its strip with it when it slides away.
  const tabBarHidden = useTabBarStore((state) => state.hidden);
  const [isRestarting, setIsRestarting] = useState(false);
  const hasHydrated = usePrefsStore((state) => state.hasHydrated);
  const onboardingCompleted = usePrefsStore((state) => state.onboardingCompleted);
  // Background reference place: the nearest main town to the device, else Hawler.
  useReferencePlace();
  // Alert places on the server follow "My location" while alerts are on on
  // this device (no request at all otherwise; migration 0062).
  useAlertPrefsAutoSync();
  // "Take a quick tour" on the last onboarding screen: open the tour once
  // onboarding is complete and the main stack (which owns "tour") is active.
  useLaunchPendingTour(onboardingCompleted);

  useEffect(() => {
    let cancelled = false;

    applyPersistedLocaleOnLaunch()
      .then(({ requiresRestart }) => {
        if (cancelled || !requiresRestart) {
          return;
        }
        // The persisted language flips reading direction relative to the
        // device-detected one — I18nManager.forceRTL only takes effect
        // after a JS reload (design-language.md §5 reload caveat).
        setIsRestarting(true);
        return restartApp();
      })
      .catch(() => {
        // If the reload itself fails (e.g. no Updates runtime available),
        // the native RTL flag is already persisted and will apply on the
        // user's next manual relaunch — nothing else to do here.
        if (!cancelled) {
          setIsRestarting(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Wire the offline felt-report queue's sync triggers once per app
    // instance: an immediate cold-start attempt (catches "queued while the
    // app was closed"), plus every subsequent foreground transition
    // (features/felt/queue.ts's own doc comment explains why this covers
    // connectivity-regain without a NetInfo dependency).
    ensureFeltQueueForegroundSync();
    void processQueue().then(() => reconcileSubmittedReports());
    // The feedback queue had the same two triggers defined but never wired
    // (2026-09-27): a submission whose first attempt failed stayed on the
    // phone until the next feedback was sent. Same cold-start drain plus
    // foreground retry as the felt-report queue above.
    ensureFeedbackQueueForegroundSync();
    void processFeedbackQueue();
    // Photos of a tagged home upload from their own on-device queue, with the
    // same two triggers (cold start, foreground).
    ensureHomePhotoQueueForegroundSync();
    void processHomePhotoQueue();
    // "I'm safe" check-ins wait on the phone until sent, same two triggers.
    ensureCheckInForegroundSync();
    void processCheckInQueue();
  }, []);

  useEffect(() => {
    // Web-only DOM mirror of the resolved scheme (Settings > Appearance) —
    // one effect here, at the root, rather than one per `useTheme()` call
    // site (`applyDocumentColorSchemeWeb`'s own doc comment).
    applyDocumentColorSchemeWeb(scheme);
  }, [scheme]);

  useEffect(() => {
    // Anonymous, coarse-location cold-start ping (spec-v1.md §5.5, D11/D13;
    // disclosed in Settings). No-ops entirely when no Supabase project is
    // configured yet or when location permission/last-known fix isn't
    // already available — see `sendColdStartTelemetryPing`'s own doc for
    // every gate; never requests a permission or a fresh GPS fix.
    void sendColdStartTelemetryPing();
  }, []);

  useEffect(() => {
    // "Last seen" for the admin People directory: at most once a day, only
    // when a session already exists (migration 0055; disclosed in Settings).
    void touchPresenceOnce();
  }, []);

  if (isRestarting || !hasHydrated) {
    // Brief blank frame while the reload takes over, or while we're still
    // reading `onboardingCompleted` from AsyncStorage — never render the
    // Stack before we know whether it should register the tab screens or
    // the onboarding screen (wave brief: "no flicker — gate on store
    // hydration").
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PersistQueryClientProvider
          client={eventsQueryClient}
          persistOptions={{
            persister: eventsPersister,
            maxAge: PERSISTED_CACHE_MAX_AGE_MS,
            // Private data (home tags: exact locations, join keys) is marked
            // `meta: { persist: false }` and never written to the device cache.
            dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
            // Bump this if the cached `Event` shape ever changes in a way
            // older persisted data can't satisfy — invalidates old caches
            // on upgrade instead of feeding stale-shaped data to new code.
            buster: "events-v1",
          }}
        >
          <StatusBar style={scheme === "dark" ? "light" : "dark"} />
          <SnackbarProvider
            bottomOffset={inTabs && !tabBarHidden ? TAB_BAR_CONTENT_HEIGHT : 0}
          >
            <Stack screenOptions={stackScreenOptions}>
              {/* Onboarding-vs-tabs gate (spec-v1.md §4.11: "first-launch
               * only, not reachable after"): registering only ONE of these
               * two screen sets — never both — means "/onboarding" and
               * "(tabs)" are each fully unreachable while the other is
               * active, with no separate redirect logic needed. React
               * Navigation resolves the new default screen itself the
               * instant `onboardingCompleted` flips (the same
               * conditional-screens pattern React Navigation's own
               * "Authentication flows" guide recommends for auth gating).
               * Expressed with `Stack.Protected`: a bare Fragment child of
               * `<Stack>` makes expo-router 57 throw "Cannot convert a Symbol
               * value to a string" and the app renders blank for every
               * returning user (found 2026-10-04). */}
              <Stack.Protected guard={onboardingCompleted}>
                <Stack.Screen name="(tabs)" />
                {/* Only the FULL-SCREEN flows are declared here; they cover
                 * the tab bar. Everything people browse (event, hub, catalogue,
                 * profiles, safety, handbook, settings pages...) lives inside
                 * the tabs, under `(tabs)/(home,map,...)`,
                 * so the bar stays. Each of these screens owns its
                 * `headerShown`/`title`/`headerLeft` via its own inline
                 * `<Stack.Screen options>` (a static `options` here was found
                 * to be silently ineffective). */}
                <Stack.Screen name="feedback" />
                <Stack.Screen name="account/sign-in" />
                <Stack.Screen name="account/profile" />
                <Stack.Screen name="account/password" />
                <Stack.Screen name="admin/index" />
                <Stack.Screen name="admin/activity" />
                <Stack.Screen name="admin/filter" />
                <Stack.Screen name="admin/hidden" />
                <Stack.Screen name="admin/limited" />
                <Stack.Screen name="admin/people" />
                <Stack.Screen name="admin/person/[id]" />
                <Stack.Screen name="admin/feedback/index" />
                <Stack.Screen name="admin/feedback/[id]" />
                <Stack.Screen name="admin/photos" />
                <Stack.Screen name="home/new" />
                <Stack.Screen name="home/join" />
                <Stack.Screen name="home/[tagId]/report" />
                <Stack.Screen name="home/[tagId]/family" />
                <Stack.Screen name="felt-report" options={{ presentation: "modal" }} />
                <Stack.Screen name="im-safe" />
                {/* The swipeable tour owns its horizontal swipes, so the iOS
                 * edge-swipe-back is off; Skip and the last button leave it. */}
                <Stack.Screen name="tour" options={{ gestureEnabled: false }} />
              </Stack.Protected>
              <Stack.Protected guard={!onboardingCompleted}>
                <Stack.Screen name="onboarding" />
              </Stack.Protected>
            </Stack>
          </SnackbarProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
