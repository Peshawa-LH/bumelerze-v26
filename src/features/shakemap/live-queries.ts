import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import type { Event } from "@/features/events";
import { isSupabaseConfigured } from "@/lib/supabase";

import { resolveAtlasLookupId } from "./atlas-lookup";
import { SHAKEMAP_LIVE_GC_TIME_MS, SHAKEMAP_LIVE_STALE_TIME_MS } from "./config";
import { parseIntensityContours } from "./contours";
import { SupabaseLiveShakeMapTransport, type LiveShakeMapTransport } from "./live-transport";
import type { LiveShakeMapProduct } from "./live-types";
import { useShakeMap, type UseShakeMapStatus } from "./queries";
import { parseRiskProduct } from "./risk";
import { resolveShakeMapProduct, type ResolvedShakeMapProduct, type ShakeMapCandidate } from "./resolver";
import type { IntensityContourSet, RiskProduct } from "./types";

export const liveShakeMapQueryKeys = {
  event: (eventId: string) => ["shakemap", "live", eventId] as const,
};

/**
 * Live `shakemap_products` lookup (Supabase). Env-gated exactly like
 * `feltmap`'s `useFeltMap`: no Supabase project configured means this path
 * is simply absent, no network call at all. React Query caches hard
 * (`SHAKEMAP_LIVE_STALE_TIME_MS`/`_GC_TIME_MS`, `config.ts`) since a
 * published product version is immutable per D9's own versioning
 * discipline — deliberately no `refetchInterval` at all (unlike the region
 * feed/felt map's active polling): this is not a live-updating stream, so
 * there is nothing to gain from polling it on a fixed cadence (PROJECT.md
 * "battery-conscious... no aggressive background polling").
 *
 * Returns `null` — never a distinct "error"/"loading" status of its own —
 * for EVERY not-ready case alike: unconfigured, still fetching, no live row
 * published yet for this event, or the transport's own promise rejected
 * (network/DB failure resolving the row or fetching the artifact). This is
 * the deliberate "fail soft" behavior the wave brief asks for: this hook's
 * only job is handing `resolveShakeMapProduct` a live candidate when one is
 * genuinely ready, or nothing — never to own a user-visible offline/error
 * state (unlike `useFeltMap`, which does own one). A slow or failed live
 * fetch therefore degrades to exactly the same "show the bundled product,
 * or show nothing" outcome `ShakeMapSection` already had before this live
 * path existed — it can never make the section WORSE than it was.
 */
export function useLiveShakeMap(
  event: Event,
  enabled: boolean,
  transport: LiveShakeMapTransport = SupabaseLiveShakeMapTransport,
): ShakeMapCandidate<LiveShakeMapProduct> | null {
  const configured = isSupabaseConfigured();

  const query = useQuery({
    queryKey: liveShakeMapQueryKeys.event(event.id),
    queryFn: () => transport.fetchLiveProduct(event),
    enabled: configured && enabled && Boolean(event.id),
    staleTime: SHAKEMAP_LIVE_STALE_TIME_MS,
    gcTime: SHAKEMAP_LIVE_GC_TIME_MS,
    retry: 1,
  });

  return useMemo(() => {
    if (!query.data) {
      // Covers both "no product" (query succeeded with null) and "the
      // fetch failed" (query.data stays undefined on error) — deliberately
      // not distinguished here, see this hook's own doc comment above.
      return null;
    }
    try {
      const contours = parseIntensityContours(query.data.contours);
      // Risk is best-effort even here: `query.data.risk` was already
      // fetched tolerantly by the transport (any missing/failed risk
      // artifact -> `null`, never a thrown rejection of the whole
      // product) — `parseRiskProduct` on top of that is one more layer of
      // "never let a risk-parsing bug break the always-present intensity
      // map", same reasoning `contours.ts`'s own tolerant per-feature
      // parsing follows.
      const risk: RiskProduct | null =
        query.data.risk !== undefined ? parseRiskProduct(query.data.risk) : null;
      return { product: query.data, contours, risk };
    } catch {
      // Malformed artifact (wave brief: "a malformed or unreachable
      // product must never break the event screen") — degrades to "no
      // live candidate"; the resolver falls back to the bundled product or
      // to absence, same as any other not-ready case above.
      return null;
    }
  }, [query.data]);
}

export interface UseResolvedShakeMapResult {
  status: UseShakeMapStatus;
  product: ResolvedShakeMapProduct | null;
  contours: IntensityContourSet | null;
  risk: RiskProduct | null;
}

/**
 * The hook `ShakeMapSection` actually calls. Composes the bundled Atlas
 * lookup (`useShakeMap`, UNCHANGED — still the only thing keeping the 11
 * curated Historical events fully offline-capable) with the live Supabase
 * lookup above, through the pure `resolveShakeMapProduct` precedence rule
 * (`resolver.ts` — see that module's doc comment for the precedence
 * itself). Same `{status, product, contours}` shape `useShakeMap` already
 * had, so callers that only cared about that shape need no other change.
 */
export function useResolvedShakeMap(event: Event, enabled: boolean): UseResolvedShakeMapResult {
  // "resolve by either id" (wave brief): a bml id that names one of the 11
  // curated Historical events resolves to its bundled provider-id key
  // first; every other event falls through to its own `id` unchanged —
  // see `resolveAtlasLookupId`'s own doc comment.
  const bundled = useShakeMap(resolveAtlasLookupId(event), enabled);
  const live = useLiveShakeMap(event, enabled);

  return useMemo(() => {
    const bundledCandidate =
      bundled.status === "ready" && bundled.product && bundled.contours
        ? { product: bundled.product, contours: bundled.contours, risk: bundled.risk }
        : null;
    const resolved = resolveShakeMapProduct(live, bundledCandidate);
    if (!resolved) {
      return { status: "absent" as const, product: null, contours: null, risk: null };
    }
    return {
      status: "ready" as const,
      product: resolved.product,
      contours: resolved.contours,
      risk: resolved.risk,
    };
  }, [live, bundled.status, bundled.product, bundled.contours, bundled.risk]);
}
