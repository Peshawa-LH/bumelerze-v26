import { Stack } from "expo-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  EventListScreen,
  isRegionSignificant,
  isWorldSignificant,
  useRegionEvents,
  useWorldEvents,
  type Event,
} from "@/features/events";

/**
 * Significant Events (spec-v1.md §4.3): region-significant ∪ world-
 * significant, ranked by `sig`, per event-pipeline-design.md §3.
 *
 * The union here is a client-side id-set merge over the two feeds we
 * already have cached — NOT the full cross-provider dedup/merge algorithm
 * from event-pipeline-design.md §2 (spatial-temporal matching across
 * providers). That's backend/Postgres work for when a second provider
 * (EMSC) joins; with USGS as the only source this wave, an event can only
 * ever appear once per feed, so a Map keyed by id is sufficient and exact.
 */
export default function SignificantScreen() {
  const { t } = useTranslation();
  const region = useRegionEvents();
  const world = useWorldEvents();

  const events = useMemo(() => {
    const byId = new Map<string, Event>();

    for (const event of region.events) {
      if (isRegionSignificant(event)) {
        byId.set(event.id, event);
      }
    }
    for (const event of world.events) {
      if (isWorldSignificant(event)) {
        byId.set(event.id, event);
      }
    }

    return Array.from(byId.values()).sort((a, b) => b.sig - a.sig);
  }, [region.events, world.events]);

  const isInitialLoading = region.isInitialLoading || world.isInitialLoading;
  // Only a genuine "nothing to show" state when BOTH feeds have failed with
  // no cache — one feed surviving still gives a useful (partial) list.
  const isHardError = region.isHardError && world.isHardError;
  const isOfflineIsh = (region.isOfflineIsh || world.isOfflineIsh) && !isHardError;
  // Older ("more stale") of the two feeds' last-successful-fetch times —
  // 0 (no data at all) is excluded from the comparison via `|| Infinity`,
  // then converted back to 0 below if neither feed has data yet.
  const rawDataUpdatedAt = Math.min(
    region.dataUpdatedAt || Infinity,
    world.dataUpdatedAt || Infinity,
  );
  const dataUpdatedAt = rawDataUpdatedAt === Infinity ? 0 : rawDataUpdatedAt;
  const isRefreshing = region.isRefreshing || world.isRefreshing;

  function handleRefetch() {
    void region.refetch();
    void world.refetch();
  }

  return (
    <>
      <Stack.Screen options={{ title: t("significant.title") }} />
      <EventListScreen
        events={events}
        isInitialLoading={isInitialLoading}
        isOfflineIsh={isOfflineIsh}
        isHardError={isHardError}
        isRefreshing={isRefreshing}
        dataUpdatedAt={dataUpdatedAt}
        emptyMessage={t("significant.emptyState")}
        onRefetch={handleRefetch}
      />
    </>
  );
}
