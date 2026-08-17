import type { AtlasBundleEntry, DataUsedSummaryKey, IntensityContourSet, ReviewStatus } from "./types";
import type { EngineVersionSummary, LiveShakeMapProduct } from "./live-types";

export type ShakeMapProductSource = "live" | "bundled";

/** One already-loaded, already-parsed candidate from a single source
 * (live or bundled) — `contours` is real `IntensityContourSet`, never the
 * raw payload, because each source's own hook (`useLiveShakeMap`/
 * `useShakeMap`) already did that parsing/validation before a candidate is
 * considered "ready" at all. `resolveShakeMapProduct` below therefore never
 * needs to know how either candidate was produced. */
export interface ShakeMapCandidate<TProduct> {
  product: TProduct;
  contours: IntensityContourSet;
}

/** Provenance fields `ShakeMapSection` renders, normalized across both
 * sources so the component never has to branch on which one produced them
 * (`source` is carried through only for tests/future diagnostics — nothing
 * in the wave brief asks the UI to tell the user WHICH source served their
 * map, only whether it is reviewed or provisional, which `reviewStatus`
 * alone already covers). */
export interface ResolvedShakeMapProduct {
  source: ShakeMapProductSource;
  version: number;
  reviewStatus: ReviewStatus;
  dataUsedSummaryKey: DataUsedSummaryKey;
  generatedAt: string;
  /** `null` for a bundled-source result — the build-time Atlas bundle does
   * not carry this yet (`live-types.ts`'s `EngineVersionSummary` doc
   * comment); never fabricated. */
  engineVersion: EngineVersionSummary | null;
}

export interface ResolvedShakeMap {
  product: ResolvedShakeMapProduct;
  contours: IntensityContourSet;
}

/**
 * The ONE precedence rule this wave's brief asks for, pulled out of
 * `ShakeMapSection`/the query hooks into a single small pure function so it
 * is trivially unit-testable and can never silently re-diverge between call
 * sites:
 *
 *   1. **LIVE wins** whenever a live product exists and already loaded +
 *      parsed successfully (`live` is non-null). Everything that should
 *      count as "not available" — no Supabase project configured, no row
 *      published yet for this event, a network/database failure resolving
 *      or querying it, a malformed row, an unreachable or malformed
 *      artifact — is already collapsed to `null` by `useLiveShakeMap`
 *      before it ever reaches this function (see that hook's own doc
 *      comment for the full list); this function does no I/O and no error
 *      handling of its own, only precedence.
 *   2. **Otherwise BUNDLED wins** — the build-time Bumelerze Atlas bundle
 *      (`atlas/index.ts`, the 11 curated Historical events), unchanged from
 *      today's D21 behavior. This is what keeps those events working fully
 *      offline exactly as before this wave, for every event that has no
 *      live product yet (which is still most events, until the worker's
 *      pre-launch compute campaign runs).
 *   3. **Otherwise nothing** — `null`, not an empty scaffold. "Absence over
 *      misattribution" (D21) — unchanged.
 */
export function resolveShakeMapProduct(
  live: ShakeMapCandidate<LiveShakeMapProduct> | null,
  bundled: ShakeMapCandidate<AtlasBundleEntry> | null,
): ResolvedShakeMap | null {
  if (live) {
    return {
      product: {
        source: "live",
        version: live.product.version,
        reviewStatus: live.product.reviewStatus,
        dataUsedSummaryKey: live.product.dataUsedSummaryKey,
        generatedAt: live.product.generatedAt,
        engineVersion: live.product.engineVersion,
      },
      contours: live.contours,
    };
  }
  if (bundled) {
    return {
      product: {
        source: "bundled",
        version: bundled.product.version,
        reviewStatus: bundled.product.reviewStatus,
        dataUsedSummaryKey: bundled.product.dataUsedSummaryKey,
        generatedAt: bundled.product.generatedAt,
        engineVersion: null,
      },
      contours: bundled.contours,
    };
  }
  return null;
}
