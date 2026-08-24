import { z } from "zod";

import type { AtlasBundleEntry, DataUsedSummaryKey } from "./types";

/**
 * Row/artifact contracts for the LIVE shakemap product path — the
 * "closing the last gap" wave. Reads `public.shakemap_products`
 * (`supabase/migrations/0006_shakemap_products.sql`,
 * `0007_shakemap_review_status.sql`, `0019_shakemap_products_index_fields
 * .sql`) as a small, queryable INDEX row (never the artifact bytes
 * themselves — `shake_service/worker/uploader.py`'s own "why not
 * everything in Supabase" doc), plus the vector artifact (`cont_mi.json`)
 * the row's `storage_path` points at in the public Bumelerze Atlas site.
 * Everything here is a pure, zod-validated boundary — no network, no React
 * — `live-transport.ts` is the only caller.
 */

/** Column list this app reads off `shakemap_products` — the single source
 * of truth both the zod schema below and `live-transport.ts`'s `.select
 * (...)` are built from (same discipline as `feltmap/types.ts`'s
 * `FELT_CELL_ROW_COLUMNS`). Deliberately narrower than the full table: no
 * `product_id`/`event_id`/`producer`/`product_type` (already known/filtered
 * by the query itself) and no `bbox_*` (migration 0019 — indexing-only,
 * unused by the event-detail display path this wave scopes to; the map-tab
 * follow-up is where bbox earns its keep). */
export const LIVE_SHAKEMAP_PRODUCT_ROW_COLUMNS = [
  "version",
  "storage_path",
  "data_used",
  "review_status",
  "reviewed_by",
  "reviewed_at",
  "created_at",
] as const;

const liveShakeMapProductRowSchema = z.object({
  version: z.number().int().positive(),
  storage_path: z.string().min(1),
  // Producer-defined jsonb (0006's own comment: "structure is producer-
  // defined... kept as JSONB rather than typed columns") — a tolerant
  // record, never a fixed shape here; `computeDataUsedSummaryKey`/
  // `extractEngineVersion` below read out of it defensively instead of
  // this schema over-constraining a column the uploader may still be
  // evolving.
  data_used: z.record(z.string(), z.unknown()),
  review_status: z.enum(["automatic", "reviewed"]),
  reviewed_by: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  created_at: z.string(),
});

export type LiveShakeMapProductRow = z.infer<typeof liveShakeMapProductRowSchema>;

export interface ParsedLiveShakeMapProductRows {
  rows: LiveShakeMapProductRow[];
  /** Same tolerant-parsing bookkeeping convention as
   * `feltmap/types.ts`'s `parseFeltCellRows` — a `shakemap_products` row
   * should never actually fail this schema (it's our own table, written by
   * one uploader), so in practice this stays 0; the tolerance exists so a
   * schema drift degrades gracefully rather than taking the whole live
   * shakemap path down with it (never the bundled Atlas fallback, per the
   * resolver's own precedence). */
  skippedCount: number;
}

/** Tolerant array parse — one malformed row is dropped and counted, never a
 * reason to discard every other version of this event's product. */
export function parseLiveShakeMapProductRows(data: unknown): ParsedLiveShakeMapProductRows {
  if (!Array.isArray(data)) {
    return { rows: [], skippedCount: 0 };
  }

  const rows: LiveShakeMapProductRow[] = [];
  let skippedCount = 0;

  for (const item of data) {
    const result = liveShakeMapProductRowSchema.safeParse(item);
    if (result.success) {
      rows.push(result.data);
    } else {
      skippedCount += 1;
    }
  }

  return { rows, skippedCount };
}

/**
 * Picks the row this app treats as "the newest product version" for one
 * event, among every `shakemap_products` `product_type = "contours"` row
 * returned for it. `shakemap_products`'s own unique constraint
 * (`event_id, producer, version, product_type`) means there is at most one
 * row per version already, so the primary rule is simply the highest
 * `version` — that literally IS "the newest product version". The
 * `review_status` tiebreak below (a `"reviewed"` row wins over an
 * `"automatic"` one at the SAME version number) should not be reachable
 * given that constraint; it is kept anyway as a defensive ordering rule so
 * a duplicate/legacy row can never silently displace a scientist-reviewed
 * one — "a reviewed product should win over a provisional one of the same
 * version generation" (wave brief), made literal.
 */
export function selectLatestLiveProductRow(
  rows: readonly LiveShakeMapProductRow[],
): LiveShakeMapProductRow | null {
  if (rows.length === 0) {
    return null;
  }
  const sorted = [...rows].sort((a, b) => {
    if (a.version !== b.version) {
      return b.version - a.version;
    }
    if (a.review_status !== b.review_status) {
      return a.review_status === "reviewed" ? -1 : 1;
    }
    return 0;
  });
  return sorted[0] ?? null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Ports `shake-service/scripts/bundle_atlas_for_app.py`'s
 * `data_used_summary_key` to TypeScript, so a LIVE product gets the exact
 * same honest, small-N-floor-aware classification the bundled Atlas
 * already computes at build time (that script's own doc comment: an event
 * whose only observations fell below the conditioning floor is
 * `"catalogOnly"`, never upgraded just because raw station/DYFI data
 * existed). Keep the two in sync if that floor logic ever changes.
 * Tolerant of a missing/malformed `data_used` shape — defaults to the most
 * conservative label (`"catalogOnly"`) rather than guessing upward.
 */
export function computeDataUsedSummaryKey(dataUsed: unknown): DataUsedSummaryKey {
  const record = asRecord(dataUsed);
  if (!record) {
    return "catalogOnly";
  }
  const applied = asRecord(record.conditioning_applied);
  const anyApplied = applied ? Object.values(applied).some((value) => value === true) : false;
  if (!anyApplied) {
    return "catalogOnly";
  }
  const usedStations =
    typeof record.instrument_stations_parsed === "number" &&
    record.instrument_stations_parsed > 0;
  const usedDyfi =
    typeof record.dyfi_boxes_parsed === "number" && record.dyfi_boxes_parsed > 0;
  if (usedStations && usedDyfi) {
    return "stationAndDyfiConditioned";
  }
  if (usedStations) {
    return "stationConditioned";
  }
  return "dyfiConditioned";
}

const engineVersionSchema = z.object({
  service_version: z.string().nullable().optional(),
  gsim_branches: z.string().nullable().optional(),
  ems_model: z.string().nullable().optional(),
  mmi_model: z.string().nullable().optional(),
  conditioning: z.string().nullable().optional(),
});

/** Coarse, translatable engine-provenance summary — mirrors
 * `info.json.version` (`shake_service/export.py`'s `build_info_product`),
 * landed verbatim into `data_used.engine_version` by the uploader
 * (`_engine_version_from_info`, `worker/uploader.py`). `conditioning` is
 * the human-readable method string (e.g. "mvn (Engler et al. 2022)..."),
 * not a boolean — `dataUsedSummaryKey` above is already the app's coarse
 * yes/no conditioning signal; this field is the citeable detail behind it. */
export interface EngineVersionSummary {
  serviceVersion: string | null;
  gsimBranches: string | null;
  emsModel: string | null;
  mmiModel: string | null;
  conditioning: string | null;
}

/**
 * Reads `data_used.engine_version` — data-architecture-v2.md §3.2's "carry
 * the engine-version block through instead of dropping it", finally
 * surfaced app-side for the live path (the bundled Atlas path does not
 * carry this yet; `bundle_atlas_for_app.py` still discards it at
 * build-bundle time, unchanged this wave — see that script's own doc
 * comment, and `resolver.ts`, which normalizes a bundled product's
 * `engineVersion` to `null` for exactly this reason). Returns `null` when
 * absent/malformed (an older product published before this field existed,
 * or a differently-shaped producer) or when every field inside it is
 * empty — never a fabricated summary.
 */
export function extractEngineVersion(dataUsed: unknown): EngineVersionSummary | null {
  const record = asRecord(dataUsed);
  if (!record) {
    return null;
  }
  const parsed = engineVersionSchema.safeParse(record.engine_version);
  if (!parsed.success) {
    return null;
  }
  const { service_version, gsim_branches, ems_model, mmi_model, conditioning } = parsed.data;
  if (!service_version && !gsim_branches && !ems_model && !mmi_model && !conditioning) {
    return null;
  }
  return {
    serviceVersion: service_version ?? null,
    gsimBranches: gsim_branches ?? null,
    emsModel: ems_model ?? null,
    mmiModel: mmi_model ?? null,
    conditioning: conditioning ?? null,
  };
}

/**
 * One resolved LIVE `shakemap_products` product (`producer = "bumelerze"`,
 * `product_type = "contours"`) — same shape as a bundled `AtlasBundleEntry`
 * (D9 "one renderer, either producer" generalizes to "either copy" —
 * `resolver.ts` relies on this to treat the two uniformly), plus
 * `engineVersion`, which no bundled entry carries yet (see that field's
 * own doc comment above). `contours` is the raw fetched `cont_mi.json`
 * payload, unparsed — parsed once, centrally, by whichever hook resolves
 * it (`live-queries.ts`'s `useLiveShakeMap`), the same "parse at render/
 * resolve time, never trust blindly just because it's ours" convention
 * `AtlasBundleEntry.contours`'s own doc comment already establishes.
 */
export interface LiveShakeMapProduct extends AtlasBundleEntry {
  engineVersion: EngineVersionSummary | null;
}
