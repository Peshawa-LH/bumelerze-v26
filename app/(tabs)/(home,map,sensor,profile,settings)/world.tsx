import { Stack } from "expo-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { EventListScreen, useWorldEvents } from "@/features/events";
import { useHiddenEarthquakes, withoutHidden } from "@/features/home-extras";

/** World Catalog (the v1 spec §4.2) — full unfiltered world feed, pushed
 * from Home, secondary to the region-first Home screen (D11). */
export default function WorldScreen() {
  const { t } = useTranslation();
  const {
    events: worldEvents,
    isInitialLoading,
    isOfflineIsh,
    isHardError,
    isRefreshing,
    dataUpdatedAt,
    refetch,
  } = useWorldEvents();
  // Earthquakes Bumelerze hid for everyone (migration 0085) are left out.
  const hidden = useHiddenEarthquakes();
  const events = useMemo(() => withoutHidden(worldEvents, hidden), [worldEvents, hidden]);

  return (
    <>
      <Stack.Screen
        options={{
          title: t("world.title"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <EventListScreen
        events={events}
        isInitialLoading={isInitialLoading}
        isOfflineIsh={isOfflineIsh}
        isHardError={isHardError}
        isRefreshing={isRefreshing}
        dataUpdatedAt={dataUpdatedAt}
        emptyMessage={t("world.emptyState")}
        onRefetch={() => void refetch()}
      />
    </>
  );
}
