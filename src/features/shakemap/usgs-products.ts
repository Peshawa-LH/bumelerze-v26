import { z } from "zod";

import { USGS_EVENT_DETAIL_ENDPOINT } from "./config";
import type { ShakeMapProduct } from "./types";

/**
 * Tolerant zod schemas for the USGS event `detail` geojson's
 * `properties.products.shakemap[]` array (teardown-usgs-dyfi.md §2,
 * spec-v1.md §4.5). Deliberately narrow: only the fields this feature
 * actually reads are listed — an object schema strips/ignores unknown
 * keys, so USGS adding new product metadata never breaks parsing (same
 * convention as `features/events/usgs-schema.ts`).
 *
 * `info.json`'s URL is captured (`ShakeMapProduct.infoUrl`) but its
 * CONTENTS are never fetched/parsed this wave — the Event Detail citation
 * line is built from `network`/`version`/`updateTime` alone (wave brief:
 * "'ShakeMap: {{network}}, version {{v}}' style"). Fetching+parsing
 * `info.json` for a richer multi-source "data used" breakdown (station
 * count, intensity-observation count, fault reference) is a natural
 * follow-up, not required for this wave's product contract.
 */
const contentEntrySchema = z.object({
  url: z.string(),
});

const shakemapProductPropertiesSchema = z.object({
  version: z.string().optional(),
});

const rawShakemapProductSchema = z.object({
  id: z.string(),
  source: z.string(),
  updateTime: z.number(),
  preferredWeight: z.number().optional(),
  properties: shakemapProductPropertiesSchema.optional(),
  // USGS ships 50-70+ content entries per product (rasters, coverage
  // grids, station lists, ...) — a record schema keyed by the content
  // path, values narrowed to just the `url` field this feature ever
  // reads.
  contents: z.record(z.string(), contentEntrySchema),
});

const detailPropertiesSchema = z.object({
  // Only `products.shakemap` is looked at; every other product type
  // (dyfi, losspager, moment-tensor, ...) and every other property on the
  // event is untyped here and simply ignored.
  products: z
    .object({
      shakemap: z.array(z.unknown()).optional(),
    })
    .partial()
    .optional(),
});

const detailFeatureSchema = z.object({
  type: z.literal("Feature"),
  properties: detailPropertiesSchema,
});

export type RawShakemapProduct = z.infer<typeof rawShakemapProductSchema>;

/**
 * Picks the preferred shakemap product from a (possibly multi-product)
 * list — USGS events can carry more than one competing shakemap submission
 * (e.g. an "atlas" backfill product alongside a live "us" network product,
 * the exact real case in this feature's own test fixture); `preferredWeight`
 * is USGS's own ranking signal, highest wins. Falls back to the first
 * candidate if none carries a weight (defensive — every real product does).
 */
function pickPreferredProduct(
  candidates: readonly RawShakemapProduct[],
): RawShakemapProduct | null {
  if (candidates.length === 0) {
    return null;
  }
  return candidates.reduce((best, candidate) =>
    (candidate.preferredWeight ?? 0) > (best.preferredWeight ?? 0) ? candidate : best,
  );
}

/**
 * Parses a USGS event `detail` geojson payload (already fetched) into this
 * feature's product-shaped contract, or `null` for every "no usable
 * ShakeMap" case: the payload doesn't parse as a detail feature at all, the
 * event has no `shakemap` product entries, none of the raw entries pass
 * schema validation, or the preferred entry has no `download/cont_mi.json`
 * content (nothing to render). This is the COMMON case for small regional
 * events (spec-v1.md §4.5 "lazy-load states") — callers must treat `null`
 * as a normal, non-error outcome, never a thing to retry or surface as a
 * failure.
 */
export function extractPreferredShakeMapProduct(
  payload: unknown,
): ShakeMapProduct | null {
  const detail = detailFeatureSchema.safeParse(payload);
  if (!detail.success) {
    return null;
  }

  const rawList = detail.data.properties.products?.shakemap;
  if (!rawList || rawList.length === 0) {
    return null;
  }

  const candidates: RawShakemapProduct[] = [];
  for (const raw of rawList) {
    const parsed = rawShakemapProductSchema.safeParse(raw);
    if (parsed.success) {
      candidates.push(parsed.data);
    }
  }

  const preferred = pickPreferredProduct(candidates);
  if (!preferred) {
    return null;
  }

  const contoursUrl = preferred.contents["download/cont_mi.json"]?.url;
  if (!contoursUrl) {
    return null;
  }

  const infoUrl = preferred.contents["download/info.json"]?.url ?? null;

  const parsedVersion = preferred.properties?.version
    ? Number.parseInt(preferred.properties.version, 10)
    : NaN;

  return {
    network: preferred.source.toUpperCase(),
    version: Number.isFinite(parsedVersion) ? parsedVersion : 1,
    updateTime: preferred.updateTime,
    contoursUrl,
    infoUrl,
  };
}

function buildDetailUrl(eventId: string): string {
  const params = new URLSearchParams({ format: "geojson", eventid: eventId });
  return `${USGS_EVENT_DETAIL_ENDPOINT}?${params.toString()}`;
}

/**
 * Fetches the USGS event detail payload and extracts its preferred
 * ShakeMap product. Network/HTTP failures THROW (so `useShakeMap`'s React
 * Query state can distinguish "offline/unreachable" from "this event
 * genuinely has no ShakeMap yet", which resolves as a successful `null`
 * — same throw-on-!ok convention as `features/events/usgs.ts`'s
 * `fetchJson`).
 */
export async function fetchShakeMapProduct(
  eventId: string,
): Promise<ShakeMapProduct | null> {
  const response = await fetch(buildDetailUrl(eventId));
  if (!response.ok) {
    throw new Error(`ShakeMap detail request failed: ${response.status} ${eventId}`);
  }
  const payload: unknown = await response.json();
  return extractPreferredShakeMapProduct(payload);
}
