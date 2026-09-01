import type { SupabaseClient } from "@supabase/supabase-js";

import type { Event } from "@/features/events";
import { toEventRegistration, type EventRegistration } from "@/features/felt";
import { getSupabaseClient } from "@/lib/supabase";

import { ATLAS_BASE_URL } from "./config";
import {
  LIVE_SHAKEMAP_PRODUCT_ROW_COLUMNS,
  computeDataUsedSummaryKey,
  extractEngineVersion,
  parseLiveShakeMapProductRows,
  selectLatestLiveProductRow,
  type LiveShakeMapProduct,
} from "./live-types";
import type { RawRiskProductPayload } from "./risk";

/**
 * Small transport seam (same shape/spirit as `feltmap/transport.ts`'s
 * `FeltMapTransport`) so `useLiveShakeMap` never talks to
 * `@supabase/supabase-js`/`fetch` directly — tests inject a fixture-backed
 * `LiveShakeMapTransport` instead of mocking the Supabase query-builder
 * chain and the network.
 */
export interface LiveShakeMapTransport {
  /** Resolves to `null` for every "no live product to show" case — no
   * Supabase project configured, the event isn't registered/known yet, no
   * `shakemap_products` row exists for it — and THROWS for a genuine
   * data-layer failure (a `shakemap_products` query error, an unreachable/
   * non-2xx artifact URL) — same "no silent catches, `null` is a real
   * answer, a throw is a real failure" split `SupabaseFeltMapTransport`
   * already uses. `useLiveShakeMap` (`live-queries.ts`) is the layer that
   * decides to treat a thrown failure the SAME as `null` for this
   * specific, best-effort/fallback-backed feature — see that hook's own
   * doc comment for why that is the correct, documented divergence from
   * `useFeltMap`'s "surface an offline state" convention. */
  fetchLiveProduct(event: Event): Promise<LiveShakeMapProduct | null>;
}

/**
 * Session-lifetime `"<provider>:<providerId>" -> internal events.event_id
 * uuid` cache — same rationale/shape as `features/felt/supabase-
 * transport.ts`'s own private `eventUuidCache` (that module's doc: "every
 * Tier1Report filed against the SAME event within one app session reuses
 * the first RPC's result... purely a network-cost optimization, never a
 * correctness dependency"). Kept as an intentionally SEPARATE module-level
 * Map rather than a cross-feature import of felt's cache — same "duplicate
 * the small thing, don't couple two features' internals together"
 * precedent `feltmap/config.ts`'s own doc comment sets for this repo; the
 * one-time cost of a cache miss here (an extra idempotent RPC round trip)
 * is cheap and never user-visible (this whole path is a background
 * best-effort fetch, not the panic-time felt-report submit path that cache
 * was built for).
 */
const eventUuidCache = new Map<string, string>();

function eventCacheKey(event: Event): string {
  return `${event.provenance.provider}:${event.provenance.providerId}`;
}

/**
 * Resolves `event` (the client's own already-normalized feed record) to
 * the canonical server `events.event_id` uuid via `upsert_event_from_client`
 * (migration 0011) — the SAME RPC the bumelerze-engine worker's own uploader
 * calls server-side to register the event a product is published against
 * (`shake_service/worker/uploader.py`'s module docstring, "event_id
 * mapping"), so by the time a live product actually exists for this event
 * the underlying row is already there for this call to find; in the
 * common case this is a pure lookup, not a fresh registration. Mirrors
 * `features/felt/supabase-transport.ts`'s own `resolveEventUuid` behavior
 * exactly ("never throws... a resolution failure must never block, only
 * degrade") — here a resolution failure degrades to "no live product for
 * this event" (the resolver then falls back to the bundled Atlas or to
 * absence), never a felt-report submission, but the same fail-soft
 * contract applies for the same reason: a background provenance lookup
 * must never be allowed to surface as a user-visible error.
 */
async function resolveEventUuid(client: SupabaseClient, event: Event): Promise<string | null> {
  const cacheKey = eventCacheKey(event);
  const cached = eventUuidCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const registration: EventRegistration = toEventRegistration(event);
  try {
    // Param names MUST carry the `p_` prefix — PostgREST resolves rpc args
    // by name against migration 0011's own PL/pgSQL parameter names (see
    // `features/felt/supabase-transport.ts`'s identical call for the
    // verified-live note on this).
    const { data, error } = await client.rpc("upsert_event_from_client", {
      p_provider: registration.provider,
      p_provider_event_id: registration.providerId,
      p_origin_time: new Date(registration.originTime).toISOString(),
      p_lat: registration.lat,
      p_lon: registration.lon,
      p_depth_km: registration.depthKm,
      p_magnitude: registration.magnitude,
      p_mag_type: registration.magType,
      p_place_name: registration.placeName,
    });

    if (error || typeof data !== "string" || data.length === 0) {
      return null;
    }

    eventUuidCache.set(cacheKey, data);
    return data;
  } catch {
    return null;
  }
}

async function fetchArtifactJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Bumelerze Atlas artifact request failed: ${response.status} ${url}`);
  }
  return response.json();
}

/** Resolves one `shakemap_products.storage_path` value to a fetchable URL
 * — already-absolute (`http(s)://...`) paths pass through untouched;
 * anything else is treated as a Supabase-Storage-relative path and
 * resolved against `ATLAS_BASE_URL` (`config.ts`'s own doc comment: two
 * eras of `storage_path` value coexist in the live table). */
function resolveArtifactUrl(storagePath: string): string {
  if (/^https?:\/\//i.test(storagePath)) {
    return storagePath;
  }
  return `${ATLAS_BASE_URL}/${storagePath.replace(/^\/+/, "")}`;
}

/** `shakemap_products` rows this event's risk-chain query can carry —
 * `product_type` itself is selected (unlike the contours query above,
 * which only filters on it) since a single `.in(...)` query returns rows
 * of THREE different types together, and the row shape otherwise gives no
 * way to tell them apart. */
const RISK_ROW_COLUMNS = ["product_type", "storage_path"] as const;

/** The risk-chain artifact types a version can publish alongside its
 * `contours` row (migrations 0027/0028) — `risk_grid` (the opt-in
 * per-cell raster) is deliberately excluded, this wave's `RiskSection`
 * never needs it. `report` (the downloadable PDF, migration 0028) is a
 * pointer only — its `storage_path` IS the artifact (a PDF URL), never
 * fetched-and-JSON-parsed the way the other three are. */
const RISK_PRODUCT_TYPES = ["risk_contours", "risk_districts", "risk_summary", "report"] as const;

/**
 * Best-effort fetch of one event version's risk bundle — a SEPARATE query
 * from the contours row above, pinned to the SAME `version` (D9's own
 * versioning discipline: a risk product only makes sense read alongside
 * the exact hazard version it was computed from). Wrapped end to end in a
 * single try/catch: ANY failure here — the query erroring, a required
 * artifact (summary or districts) missing, a malformed response, a slow/
 * unreachable artifact URL — degrades to `null` ("no risk"), never to a
 * thrown rejection of the whole `fetchLiveProduct` call. This is the
 * documented, deliberate divergence from the contours path's "throw on a
 * real failure" convention: the intensity map is the always-present
 * feature this whole section exists to show, and a risk product is purely
 * additive on top of it — it must never be able to take the intensity map
 * down with it.
 */
async function fetchRiskBundle(
  client: SupabaseClient,
  internalEventId: string,
  version: number,
): Promise<RawRiskProductPayload | null> {
  try {
    const { data, error } = await client
      .from("shakemap_products")
      .select(RISK_ROW_COLUMNS.join(", "))
      .eq("event_id", internalEventId)
      .eq("producer", "bumelerze")
      .eq("version", version)
      .in("product_type", RISK_PRODUCT_TYPES);

    if (error || !Array.isArray(data)) {
      return null;
    }

    const storagePathByType = new Map<string, string>();
    for (const row of data) {
      if (row === null || typeof row !== "object") {
        continue;
      }
      const record = row as Record<string, unknown>;
      if (typeof record.product_type === "string" && typeof record.storage_path === "string") {
        storagePathByType.set(record.product_type, record.storage_path);
      }
    }

    const summaryPath = storagePathByType.get("risk_summary");
    const districtsPath = storagePathByType.get("risk_districts");
    if (!summaryPath || !districtsPath) {
      // Both required for a coherent dashboard (RiskSection's headline +
      // district table both need them) — a partial publish is treated the
      // same as no risk product at all, never a half-populated section.
      return null;
    }
    const damageContoursPath = storagePathByType.get("risk_contours");
    const reportPath = storagePathByType.get("report");

    const [summary, districts, damageContours] = await Promise.all([
      fetchArtifactJson(resolveArtifactUrl(summaryPath)),
      fetchArtifactJson(resolveArtifactUrl(districtsPath)),
      damageContoursPath ? fetchArtifactJson(resolveArtifactUrl(damageContoursPath)) : null,
    ]);
    // Not fetched — see `RISK_PRODUCT_TYPES`'s own doc comment above.
    const reportUrl = reportPath ? resolveArtifactUrl(reportPath) : null;

    return { summary, districts, damageContours, reportUrl };
  } catch {
    return null;
  }
}

/**
 * The real `LiveShakeMapTransport`, wired the moment a Supabase project
 * exists (`isSupabaseConfigured()` gate lives in `live-queries.ts`, same
 * layering as `feltmap`). For one event: resolve its internal uuid, read
 * every `shakemap_products` "contours" row published for it (`producer =
 * "bumelerze"` — D21, our own product only, never USGS pass-through),
 * pick the newest (`selectLatestLiveProductRow`), then fetch that row's
 * public artifact URL. Read-only end to end — this never writes a
 * `shakemap_products` row itself (only the bumelerze-engine worker's own
 * uploader does that); the one write this transport can trigger is
 * `upsert_event_from_client`'s idempotent event registration, identical to
 * what `features/felt`'s own resolver already does for the same event.
 */
export const SupabaseLiveShakeMapTransport: LiveShakeMapTransport = {
  async fetchLiveProduct(event: Event): Promise<LiveShakeMapProduct | null> {
    const client = getSupabaseClient();
    if (!client) {
      // Defensive only — `useLiveShakeMap` gates on `isSupabaseConfigured()`
      // itself, so this branch shouldn't run in practice. Matches
      // `SupabaseFeltMapTransport`'s identical defensive branch.
      return null;
    }

    const internalEventId = await resolveEventUuid(client, event);
    if (!internalEventId) {
      return null;
    }

    const { data, error } = await client
      .from("shakemap_products")
      .select(LIVE_SHAKEMAP_PRODUCT_ROW_COLUMNS.join(", "))
      .eq("event_id", internalEventId)
      .eq("producer", "bumelerze")
      .eq("product_type", "contours");

    if (error) {
      // Genuine data-layer failure — no silent catch (this transport's own
      // doc comment above; same convention as `SupabaseFeltMapTransport`'s
      // identical rethrow). `useLiveShakeMap` is the layer that decides to
      // fail THIS specific best-effort feature soft rather than surface a
      // visible error state.
      throw error;
    }

    const { rows } = parseLiveShakeMapProductRows(data ?? []);
    const chosen = selectLatestLiveProductRow(rows);
    if (!chosen) {
      return null;
    }

    // A slow/unreachable artifact throws here (fetchArtifactJson's own
    // non-2xx/network-failure path) — same "throw on a real fetch
    // failure" convention as `features/events/usgs.ts`'s `fetchJson`;
    // again, `useLiveShakeMap` is what turns this into a soft fallback
    // rather than a visible error.
    const contours = await fetchArtifactJson(resolveArtifactUrl(chosen.storage_path));

    // Best-effort, same version — see `fetchRiskBundle`'s own doc comment
    // for why this never throws/blocks the intensity map above.
    const risk = await fetchRiskBundle(client, internalEventId, chosen.version);

    return {
      eventId: event.id,
      producer: "bumelerze",
      version: chosen.version,
      reviewStatus: chosen.review_status,
      dataUsedSummaryKey: computeDataUsedSummaryKey(chosen.data_used),
      generatedAt: chosen.created_at,
      contours,
      engineVersion: extractEngineVersion(chosen.data_used),
      risk,
    };
  },
};
