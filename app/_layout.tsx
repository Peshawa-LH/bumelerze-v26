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

  if (isRestarting) {
    // Brief blank frame while the reload takes over.
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
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="event/[id]" options={{ headerShown: true }} />
            <Stack.Screen name="world" options={{ headerShown: true }} />
            <Stack.Screen name="significant" options={{ headerShown: true }} />
          </Stack>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
