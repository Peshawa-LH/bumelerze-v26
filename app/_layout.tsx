// Side-effect import, web no-op on native: self-heal reload when a stale
// cached page requests lazy chunks a newer deploy removed (see the module).
import "@/lib/web-chunk-reload";

import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import {
  createEventsPersister,
  createEventsQueryClient,
  PERSISTED_CACHE_MAX_AGE_MS,
} from "@/features/events/queries";
import { ensureFeltQueueForegroundSync, processQueue } from "@/features/felt";
import { usePrefsStore } from "@/features/onboarding";
import { sendColdStartTelemetryPing } from "@/features/telemetry";
// Side effect: initializes i18next before the first render, in addition to
// the named import below.
import { applyPersistedLocaleOnLaunch } from "@/i18n";
import { restartApp } from "@/i18n/restart-app";
import { useTheme } from "@/theme";

// Created once per app instance (module scope, not per render) so the
// persisted cache round-trips through the SAME client across re-renders —
// creating a new QueryClient on every render would defeat the persister
// (offline/cold-start requirement, PROJECT.md).
const eventsQueryClient = createEventsQueryClient();
const eventsPersister = createEventsPersister();

export default function RootLayout() {
  const { colors, scheme } = useTheme();
  const [isRestarting, setIsRestarting] = useState(false);
  const hasHydrated = usePrefsStore((state) => state.hasHydrated);
  const onboardingCompleted = usePrefsStore((state) => state.onboardingCompleted);

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
    void processQueue();
  }, []);

  useEffect(() => {
    // Anonymous, coarse-location cold-start ping (spec-v1.md §5.5, D11/D13;
    // disclosed in Settings). No-ops entirely when no Supabase project is
    // configured yet or when location permission/last-known fix isn't
    // already available — see `sendColdStartTelemetryPing`'s own doc for
    // every gate; never requests a permission or a fresh GPS fix.
    void sendColdStartTelemetryPing();
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
            // Bump this if the cached `Event` shape ever changes in a way
            // older persisted data can't satisfy — invalidates old caches
            // on upgrade instead of feeding stale-shaped data to new code.
            buster: "events-v1",
          }}
        >
          <StatusBar style={scheme === "dark" ? "light" : "dark"} />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.surface.base },
              headerStyle: { backgroundColor: colors.surface.base },
              headerTintColor: colors.text.primary,
              headerTitleStyle: { color: colors.text.primary },
              headerShadowVisible: false,
            }}
          >
            {/* Onboarding-vs-tabs gate (spec-v1.md §4.11: "first-launch
             * only, not reachable after"): registering only ONE of these
             * two screen sets — never both — means "/onboarding" and
             * "(tabs)" are each fully unreachable while the other is
             * active, with no separate redirect logic needed. React
             * Navigation resolves the new default screen itself the
             * instant `onboardingCompleted` flips (the same
             * conditional-screens pattern React Navigation's own
             * "Authentication flows" guide recommends for auth gating). */}
            {onboardingCompleted ? (
              <>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="event/[id]" options={{ headerShown: true }} />
                <Stack.Screen name="world" options={{ headerShown: true }} />
                <Stack.Screen name="significant" options={{ headerShown: true }} />
                <Stack.Screen name="historical" options={{ headerShown: true }} />
                <Stack.Screen name="handbook" options={{ headerShown: true }} />
                <Stack.Screen
                  name="notification-settings"
                  options={{ headerShown: true }}
                />
                <Stack.Screen name="my-data" options={{ headerShown: true }} />
                <Stack.Screen name="feedback" options={{ headerShown: true }} />
                <Stack.Screen name="felt-report" options={{ presentation: "modal" }} />
              </>
            ) : (
              <Stack.Screen name="onboarding" />
            )}
          </Stack>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
