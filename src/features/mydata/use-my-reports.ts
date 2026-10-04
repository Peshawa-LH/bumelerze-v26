import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  reconcileSubmittedReports,
  sortQueueItemsNewestFirst,
  useFeltQueueHasHydrated,
  useFeltQueueItems,
} from "@/features/felt";
import { buildContributionRow, type ContributionRowViewModel } from "./format";

export interface MyReports {
  /** False until the persisted queue has been read back (do not flash empty). */
  hasHydrated: boolean;
  /** Newest first. Empty until hydrated. */
  rows: ContributionRowViewModel[];
  count: number;
}

/**
 * The reports this phone sent, newest first, as list rows. The local queue is
 * the whole source (it already holds everything, so this works offline); the
 * one server call forgets sent reports the server no longer has. Shared by
 * the My account page (latest three) and the full list.
 */
export function useMyReports(): MyReports {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const hasHydrated = useFeltQueueHasHydrated();
  const items = useFeltQueueItems();

  useEffect(() => {
    if (hasHydrated) {
      void reconcileSubmittedReports();
    }
  }, [hasHydrated]);

  // Sorting/mapping happen here, not inside the zustand selector: see
  // `useFeltQueueItems` for the render loop that would cause.
  const rows = useMemo(
    () =>
      hasHydrated
        ? sortQueueItemsNewestFirst(items).map((item) =>
            buildContributionRow(item, locale, t),
          )
        : [],
    [hasHydrated, items, locale, t],
  );

  return { hasHydrated, rows, count: rows.length };
}
