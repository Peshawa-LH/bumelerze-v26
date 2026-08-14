/**
 * Internal event model (spec-v1.md §5.1, PROJECT.md gotcha: "normalize early
 * through the internal event model, never scatter feed-specific parsing
 * through the UI"). Provider-agnostic in shape — a future EMSC (or GEOFON,
 * AFAD) provider must map into this exact same type, not a USGS-flavored
 * variant of it. Only `normalize.ts` (per provider) and `usgs.ts` know
 * anything about USGS's field names; everything past that boundary reads
 * `Event`.
 */

/** Providers this internal model can represent. USGS was the only one wired
 * in Phase 1 (spec-v1.md §9); EMSC joined as the region feed's fallback
 * provider (D4 second tier, event-pipeline-design.md §1) — a type-level
 * addition, not a shape change, exactly as designed. GEOFON (GFZ) joined as
 * the third catalog (D4 named it from the start: USGS > EMSC > GEOFON
 * authority order) the same way. Adding a provider is exactly this: extend
 * the union, add a normalize fn, plug into the merge list —
 * `docs/research/provider-architecture.md` documents the full contract
 * (including the future Kurdistan/Iraq data center slot). */
export type EventProvider = "usgs" | "emsc" | "geofon";

export interface EventProvenance {
  provider: EventProvider;
  /** The provider's own event ID (USGS: the `ids`/feature `id` field). Kept
   * distinct from our internal `Event.id` so a future dedup/merge step
   * (event-pipeline-design.md §2) can attach multiple provenance records to
   * one internal event without an ID collision. */
  providerId: string;
  /** When *we* fetched/parsed this record, client clock, UTC ms. */
  fetchedAt: number;
  /** The provider's own "last updated" timestamp (USGS `properties.updated`),
   * UTC ms — distinct from fetchedAt; this is when the provider last revised
   * the record, not when we last saw it. */
  providerUpdatedAt: number;
}

export interface EventMagnitude {
  value: number;
  /** Provider-reported magnitude type (USGS `magType`: "mb", "ml", "mww",
   * ...). Free-form string, not an enum — providers use inconsistent and
   * evolving type codes; the internal model doesn't try to normalize them. */
  type: string;
}

/**
 * One physical earthquake, normalized. Field-level provenance beyond
 * `provenance` itself (per-field source attribution across providers,
 * event-pipeline-design.md §2 "canonical parameter derivation") is a
 * multi-provider-era concern — out of scope while USGS is the only source
 * (spec-v1.md §9 "single provider, prove the normalized model first").
 */
export interface Event {
  /** Provider-agnostic identity field — today this equals
   * `provenance.providerId` (USGS's event id), but the *field name* must
   * never imply "USGS id" so a future dedup/merge step can repoint it at an
   * internal UUID without a rename (event-pipeline-design.md §1). */
  id: string;
  /** Origin time, UTC ms. */
  originTime: number;
  lat: number;
  lon: number;
  depthKm: number;
  magnitude: EventMagnitude;
  /** Provider-supplied free-text place description (USGS `properties.place`,
   * e.g. "32 km SE of Halabja, Iraq"). */
  placeName: string;
  provenance: EventProvenance;
  /** Client-side significance approximation, event-pipeline-design.md §3.
   * See normalize.ts for the formula and its Phase-1 felt-term=0 caveat. */
  sig: number;
  /** True when the epicenter falls inside `config.REGION_BBOX`. */
  isRegional: boolean;
  /** Link to the provider's own event page (USGS `properties.url`). */
  url: string;
}
