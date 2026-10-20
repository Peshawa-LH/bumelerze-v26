// Side-effect import, web no-op on native: self-heal reload when a stale
// cached page requests lazy chunks a newer deploy removed (see the module).
import "@/lib/web-chunk-reload";
// Side-effect import, web only: the cut-down icon font (see the module).
import "@/lib/web-icon-font";

import Ionicons from "@expo/vector-icons/Ionicons";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Stack, usePathname, useSegments } from "expo-router";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { useTranslation } from "react-i18next";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppRoot } from "@/components/AppRoot";
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
// Deep imports (not the feature index files) on purpose: everything this
// file imports is part of the web app's first download, and the index files
// also pull in screens and data the first screen does not need.
import {
  ensureFeedbackQueueForegroundSync,
  processFeedbackQueue,
  useFeedbackQueueStore,
} from "@/features/feedback/queue";
import {
  ensureFeltQueueForegroundSync,
  processQueue,
  reconcileSubmittedReports,
  useFeltQueueStore,
} from "@/features/felt/queue";
import { useAlertPrefsAutoSync } from "@/features/alerts/prefs-sync";
import { useReferencePlace } from "@/features/location/reference-place";
import { usePrefsStore } from "@/features/onboarding/store";
import { touchPresenceOnce } from "@/features/presence/touch";
import {
  ensureCheckInForegroundSync,
  processCheckInQueue,
  useCheckInStore,
} from "@/features/safe/queue";
import { sendColdStartTelemetryPing } from "@/features/telemetry/ping";
import { useTabBarStore } from "@/features/tab-bar/store";
import { useLaunchPendingTour } from "@/features/tour/launch";
import { useDocumentTitle } from "@/lib/document-title";
import {
  isTabRootPath,
  startOfflineShell,
  startUpdateOnResume,
} from "@/lib/offline-shell";
import { shouldPersistQuery } from "@/lib/persist-filter";
import {
  holdSplashScreen,
  useSplashScreenGate,
  useSystemBackgroundColor,
} from "@/lib/splash";
// Side effect: initializes i18next before the first render, in addition to
// the named import below.
import {
  ARABIC_SCRIPT_LOCALES,
  applyPersistedLocaleOnLaunch,
  initialLocaleReady,
  isInitialLocaleReady,
  type SupportedLocale,
} from "@/i18n";
import { restartApp } from "@/i18n/restart-app";
import { applyDocumentColorSchemeWeb, useTheme, useThemePreferencesStore } from "@/theme";

// iOS/Android: the splash screen stays up until the first screen can draw
// (`useSplashScreenGate` below; src/lib/splash.ts). Nothing on the web.
holdSplashScreen();

const VAZIRMATN_FACES = {
  "Vazirmatn-Regular": require("../assets/fonts/Vazirmatn-Regular.ttf"),
  "Vazirmatn-Medium": require("../assets/fonts/Vazirmatn-Medium.ttf"),
  "Vazirmatn-SemiBold": require("../assets/fonts/Vazirmatn-SemiBold.ttf"),
  "Vazirmatn-Bold": require("../assets/fonts/Vazirmatn-Bold.ttf"),
};
const NO_FONTS = {};
// iOS/Android: Vazirmatn and the icon font are built into the app
// (app.config.ts, expo-font), so registering them under the names the app
// asks for ("ionicons" for the icons) is quick and needs no network.
const NATIVE_FONTS = { ...VAZIRMATN_FACES, ...Ionicons.font };

// Created once per app instance (module scope, not per render) so the
// persisted cache round-trips through the SAME client across re-renders —
// creating a new QueryClient on every render would defeat the persister
// (offline/cold-start requirement, the project requirements).
const eventsQueryClient = createEventsQueryClient();
const eventsPersister = createEventsPersister();

/**
 * Update on resume (web: a newer deploy; iOS/Android: a downloaded EAS
 * Update): whether reloading right now would cost the person anything. Only
 * on a tab root (never inside a felt report, a check-in, a form or an event
 * page), and never while a report, check-in or feedback is being sent.
 */
function isReloadSafe(pathname: string): boolean {
  if (!isTabRootPath(pathname)) {
    return false;
  }
  const sending =
    useFeltQueueStore.getState().items.some((item) => item.state === "syncing") ||
    useCheckInStore.getState().items.some((item) => item.state === "syncing") ||
    useFeedbackQueueStore.getState().items.some((item) => item.state === "syncing");
  return !sending;
}

export default function RootLayout() {
  const { scheme, colors } = useTheme();
  const stackScreenOptions = useStackScreenOptions();
  // Vazirmatn for Arabic-script locales (`src/theme/typography.ts`'s
  // `ARABIC_SCRIPT_FONT`). Web: not awaited: text renders in the fallback
  // face until the file is in, then re-renders — better than a blank first
  // paint on a weak connection. The four faces (about 270 KB) are
  // downloaded only while Sorani or Arabic is the language: English and
  // Kurmanji never use them, and switching into an Arabic-script language
  // reloads the page anyway (reading direction changes); the icons come
  // from src/lib/web-icon-font.web.ts. iOS/Android: built into the app, with
  // the icon font (`NATIVE_FONTS`).
  const { i18n } = useTranslation();
  const fontMap =
    Platform.OS !== "web"
      ? NATIVE_FONTS
      : ARABIC_SCRIPT_LOCALES.includes(i18n.language as SupportedLocale)
        ? VAZIRMATN_FACES
        : NO_FONTS;
  const [fontsLoaded, fontError] = useFonts(fontMap);
  // The web build downloads the language file in use before the first
  // screen (src/i18n/locale-resources.web.ts); immediate on iOS/Android.
  const [localeReady, setLocaleReady] = useState(isInitialLocaleReady);
  useEffect(() => {
    if (localeReady) {
      return;
    }
    let active = true;
    void initialLocaleReady.then(() => {
      if (active) {
        setLocaleReady(true);
      }
    });
    return () => {
      active = false;
    };
  }, [localeReady]);
  // A snackbar sits above the tab bar on the tab screens and at the bottom
  // edge elsewhere.
  const segments = useSegments();
  const inTabs = (segments as string[])[0] === "(tabs)";
  // Web: the browser tab's title follows the screen (nothing on iOS/Android).
  useDocumentTitle();
  // A newer version is picked up when the app comes back into view (web: the
  // page; iOS/Android: the foreground, through EAS Update), but only at a
  // moment that costs nothing (`isReloadSafe`, read at that moment).
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);
  useEffect(
    () =>
      startUpdateOnResume({ isSafeToReload: () => isReloadSafe(pathnameRef.current) }),
    [],
  );
  // The scroll-aware tab bar takes its strip with it when it slides away.
  const tabBarHidden = useTabBarStore((state) => state.hidden);
  const [isRestarting, setIsRestarting] = useState(false);
  const hasHydrated = usePrefsStore((state) => state.hasHydrated);
  const themeHydrated = useThemePreferencesStore((state) => state.hasHydrated);
  // The saved language is applied (or a restart into it has begun).
  const [launchLanguageChecked, setLaunchLanguageChecked] = useState(false);
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
        if (cancelled) {
          return;
        }
        if (!requiresRestart) {
          setLaunchLanguageChecked(true);
          return;
        }
        // The persisted language flips reading direction relative to the
        // device-detected one — I18nManager.forceRTL only takes effect
        // after a JS reload (the design language §5 reload caveat).
        setIsRestarting(true);
        return restartApp();
      })
      .catch(() => {
        // If the reload itself fails (e.g. no Updates runtime available),
        // the native RTL flag is already persisted and will apply on the
        // user's next manual relaunch — nothing else to do here.
        if (!cancelled) {
          setIsRestarting(false);
          setLaunchLanguageChecked(true);
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

  // iOS/Android: the splash screen goes once the first screen can draw in
  // its final form: settings and the Appearance choice read from the phone,
  // the language ready and applied, Vazirmatn and the icons registered (a
  // font that fails to register must not hold the app back). No blank or
  // white frame between the splash and the first screen, also in dark mode.
  const firstScreenReady =
    !isRestarting &&
    hasHydrated &&
    themeHydrated &&
    localeReady &&
    launchLanguageChecked &&
    (fontsLoaded || fontError !== null);
  useSplashScreenGate(firstScreenReady);
  // iOS/Android: the window behind the screens takes the app's background.
  useSystemBackgroundColor(colors.surface.base);

  useEffect(() => {
    // Web-only DOM mirror of the resolved scheme (Settings > Appearance) —
    // one effect here, at the root, rather than one per `useTheme()` call
    // site (`applyDocumentColorSchemeWeb`'s own doc comment).
    applyDocumentColorSchemeWeb(scheme);
  }, [scheme]);

  useEffect(() => {
    // Anonymous, coarse-location cold-start ping (the v1 spec §5.5, D11/D13;
    // disclosed in Settings). No-ops entirely when no Supabase project is
    // configured yet or when location permission/last-known fix isn't
    // already available — see `sendColdStartTelemetryPing`'s own doc for
    // every gate; never requests a permission or a fresh GPS fix.
    void sendColdStartTelemetryPing();
  }, []);

  useEffect(() => {
    // Web only: the service worker that lets the app open without signal
    // (src/lib/offline-shell.web.ts). Nothing on iOS/Android.
    startOfflineShell();
  }, []);

  useEffect(() => {
    // "Last seen" for the admin People directory: at most once a day, only
    // when a session already exists (migration 0055; disclosed in Settings).
    void touchPresenceOnce();
  }, []);

  if (isRestarting || !hasHydrated || !localeReady) {
    // Brief blank frame while the reload takes over, or while we're still
    // reading `onboardingCompleted` from AsyncStorage — never render the
    // Stack before we know whether it should register the tab screens or
    // the onboarding screen (brief: "no flicker — gate on store
    // hydration"). iOS/Android show the splash screen meanwhile.
    return null;
  }

  return (
    <AppRoot>
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
              {/* Onboarding-vs-tabs gate (the v1 spec §4.11: "first-launch
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
                <Stack.Screen name="admin/moderation" />
                <Stack.Screen name="admin/stats" />
                <Stack.Screen name="admin/hubs" />
                <Stack.Screen name="officials" />
                <Stack.Screen name="home/new" />
                <Stack.Screen name="home/join" />
                <Stack.Screen name="home/[tagId]/report" />
                <Stack.Screen name="home/[tagId]/family" />
                {/* The felt report covers the whole screen, as on the web: an
                 * iOS page sheet ("modal") closed with a downward swipe in
                 * the middle of a report, and its screens' safe-area top
                 * padding was added twice below the sheet's own top gap.
                 * Leaving it goes through the flow's own buttons. */}
                <Stack.Screen
                  name="felt-report"
                  options={{ presentation: "fullScreenModal" }}
                />
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
    </AppRoot>
  );
}
