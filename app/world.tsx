import { Stack } from "expo-router";
import { useTranslation } from "react-i18next";

import { EventListScreen, useWorldEvents } from "@/features/events";

/** World Catalog (spec-v1.md §4.2) — full unfiltered world feed, pushed
 * from Home, secondary to the region-first Home screen (D11). */
export default function WorldScreen() {
  const { t } = useTranslation();
  const {
    events,
    isInitialLoading,
    isOfflineIsh,
    isHardError,
    isRefreshing,
    dataUpdatedAt,
    refetch,
  } = useWorldEvents();

  return (
    <>
      <Stack.Screen options={{ title: t("world.title") }} />
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
