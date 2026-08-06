import { useQuery } from "@tanstack/react-query";

import { fetchIntensityContours } from "./contours";
import { fetchShakeMapProduct } from "./usgs-products";
import type { IntensityContourSet, ShakeMapProduct } from "./types";

export const shakeMapQueryKeys = {
  byEvent: (eventId: string) => ["shakemap", eventId] as const,
};

interface ShakeMapQueryData {
  product: ShakeMapProduct;
  contours: IntensityContourSet;
}

/** Two-stage fetch (product, then its contours) as a single React Query
 * entry — the caller only ever cares about "do we have a usable ShakeMap
 * to show", not the two network round trips it took to find out. */
async function fetchShakeMap(eventId: string): Promise<ShakeMapQueryData | null> {
  const product = await fetchShakeMapProduct(eventId);
  if (!product) {
    return null;
  }
  const contours = await fetchIntensityContours(product.contoursUrl);
  return { product, contours };
}

/** ShakeMap products revise far less often than the live event feed (a
 * version bump is a whole re-conditioning run, D9) — a much longer stale
 * time than `events/config.ts`'s 30s avoids ever re-fetching a multi-
 * hundred-KB contour payload on every Event Detail re-render. */
const SHAKEMAP_STALE_TIME_MS = 10 * 60_000;

export type UseShakeMapStatus = "loading" | "unavailableOffline" | "absent" | "ready";

export interface UseShakeMapResult {
  status: UseShakeMapStatus;
  product: ShakeMapProduct | null;
  contours: IntensityContourSet | null;
}

/**
 * Lazy, cached ShakeMap lookup for one event (spec-v1.md §4.5): fires only
 * while `enabled` (the caller mounts this only when the ShakeMap section is
 * actually in the tree — never on the Event Detail header path). Uses the
 * app's single shared `QueryClient` (see `app/_layout.tsx`), so a
 * previously-fetched ShakeMap rides the same `AsyncStorage` persister as
 * the event feed and survives a cold start with no network — the offline
 * case then only shows `"unavailableOffline"` for an event whose ShakeMap
 * was never fetched at all while online.
 */
export function useShakeMap(eventId: string, enabled: boolean): UseShakeMapResult {
  const query = useQuery({
    queryKey: shakeMapQueryKeys.byEvent(eventId),
    queryFn: () => fetchShakeMap(eventId),
    enabled: enabled && Boolean(eventId),
    staleTime: SHAKEMAP_STALE_TIME_MS,
  });

  if (!enabled || query.isPending) {
    return { status: "loading", product: null, contours: null };
  }
  if (query.isError) {
    return { status: "unavailableOffline", product: null, contours: null };
  }
  if (!query.data) {
    return { status: "absent", product: null, contours: null };
  }
  return { status: "ready", product: query.data.product, contours: query.data.contours };
}
