import {
  ALERT_BONUS,
  REGION_BBOX,
  SIGNIFICANCE_THRESHOLDS,
} from "./config";
import type { EmscFeature } from "./emsc-schema";
import type { GeofonRow } from "./geofon-schema";
import type { EventsWithSourcesRow, PrimarySourceRow } from "./supabase-event-schema";
import type { UsgsFeature } from "./usgs-schema";
import type { Event, EventProvider } from "./types";

/** True when a point falls inside the region bbox (event-pipeline-design.md
 * §4). Pure function, kept separate from normalization so distance/UI code
 * can reuse it without re-normalizing an event. */
export function isInRegionBbox(lat: number, lon: number): boolean {
  return (
    lat >= REGION_BBOX.minLat &&
    lat <= REGION_BBOX.maxLat &&
    lon >= REGION_BBOX.minLon &&
    lon <= REGION_BBOX.maxLon
  );
}

/**
 * Client-side significance score, event-pipeline-design.md §3:
 *   sig = round(100*M + felt_term + alert_bonus)
 * felt_term is our OWN felt-report count, saturating at 60*log10(1+n),
 * capped at 200. Our felt-report system doesn't exist yet (that's Phase 2),
 * so felt_term is hard-pinned to 0 here — NOT a stand-in for USGS's own
 * `felt`/`cdi` fields, which we deliberately never fold into our score
 * (D8 "our felt dataset is ours"). Revisit this function once Phase 2 wires
 * real felt-report counts per event.
 */
const FELT_TERM_PHASE_1 = 0;

export function computeClientSig(
  magnitudeValue: number,
  alert: string | null | undefined,
): number {
  const alertBonus = alert ? (ALERT_BONUS[alert] ?? 0) : 0;
  return Math.round(100 * magnitudeValue + FELT_TERM_PHASE_1 + alertBonus);
}

/** event-pipeline-design.md §3 classification — region-significant requires
 * both the bbox flag AND the sig threshold. */
export function isRegionSignificant(event: Event): boolean {
  return event.isRegional && event.sig >= SIGNIFICANCE_THRESHOLDS.regionSignificant;
}

export function isWorldSignificant(event: Event): boolean {
  return event.sig >= SIGNIFICANCE_THRESHOLDS.worldSignificant;
}

/**
 * USGS GeoJSON feature -> internal Event. This is the ONLY place USGS field
 * names may appear outside `usgs.ts`/`usgs-schema.ts` (PROJECT.md gotcha). A
 * future `normalizeEmscFeature` lives beside this one and produces the
 * exact same `Event` shape.
 *
 * Returns `null` for a structurally-valid-but-unusable feature (e.g. a
 * placeholder magnitude of `null`, which USGS emits for not-yet-reviewed
 * events) rather than throwing — callers count and skip these, never crash
 * (tolerant-parsing requirement, wave brief).
 */
export function normalizeUsgsFeature(
  feature: UsgsFeature,
  fetchedAt: number,
): Event | null {
  const { properties, geometry, id } = feature;
  const [lon, lat, depthKm] = geometry.coordinates;

  // USGS emits `mag: null` for events pending review — not yet usable.
  if (properties.mag === null) {
    return null;
  }

  const providerId = properties.ids
    ? properties.ids.split(",").find((entry) => entry.length > 0) ?? id
    : id;

  const event: Event = {
    id,
    // Live USGS feed features never carry a bml id at parse time — see
    // `types.ts`'s own doc comment; resolved later, per screen, via
    // `resolveBumelerzeId` (`bumelerze-id.ts`), never fabricated here.
    bumelerzeId: null,
    originTime: properties.time,
    lat,
    lon,
    depthKm,
    magnitude: {
      value: properties.mag,
      type: properties.magType ?? "unknown",
    },
    placeName: properties.place ?? "",
    provenance: {
      provider: "usgs",
      providerId,
      fetchedAt,
      providerUpdatedAt: properties.updated,
    },
    sig: computeClientSig(properties.mag, properties.alert),
    isRegional: isInRegionBbox(lat, lon),
    url: properties.url ?? "",
  };

  return event;
}

/**
 * EMSC seismicportal.eu fdsnws feature -> internal Event. Mirrors
 * `normalizeUsgsFeature` above (same `Event` shape, same skip-not-throw
 * contract for structurally-valid-but-unusable features) but reads EMSC's
 * differently-shaped `properties` (emsc-schema.ts) — this is the ONLY place
 * EMSC field names may appear outside `emsc.ts`/`emsc-schema.ts` (PROJECT.md
 * gotcha).
 *
 * Two EMSC-specific notes for `computeClientSig`:
 * - EMSC has no PAGER-equivalent alert field, so the alert bonus is always
 *   0 for an EMSC-sourced event — EMSC events can never get the alert-bonus
 *   boost a USGS "orange"/"red" event gets. This is a real, accepted
 *   asymmetry (wave brief point 1), not a bug: it only matters while an
 *   event is EMSC-only, and USGS's own record (once it appears) supersedes
 *   it via the merge's USGS-canonical preference (merge.ts).
 * - EMSC also has no felt/CDI data of its own feeding this score — same as
 *   USGS, our own felt term stays pinned to `FELT_TERM_PHASE_1` regardless
 *   of provider (D8, see the comment above `computeClientSig`).
 *
 * `time`/`lastupdate` are ISO 8601 strings (unlike USGS's epoch-ms
 * numbers) — parsed with `Date.parse`; an unparseable `time` makes the
 * feature unusable (returns `null`, counted, never thrown) since origin
 * time is load-bearing for every downstream consumer. An unparseable
 * `lastupdate` is less critical — falls back to the origin time rather
 * than discarding an otherwise-good feature.
 */
/** True when an ISO 8601 string carries an explicit zone designator ("Z" or
 * a ±hh[:]mm offset). FDSN text times normally carry NONE — they are UTC by
 * spec — but `Date.parse` reads a zone-less ISO time as LOCAL time, so
 * `normalizeGeofonRow` appends "Z" exactly when the designator is absent
 * (never blindly: a hypothetical source that DID emit an offset must not be
 * corrupted into "…+01:00Z"). */
const ISO_ZONE_DESIGNATOR_RE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

function parseFdsnTextTimeUtc(value: string): number {
  const withZone = ISO_ZONE_DESIGNATOR_RE.test(value) ? value : `${value}Z`;
  return Date.parse(withZone);
}

/**
 * GEOFON fdsnws `format=text` row -> internal Event. Mirrors
 * `normalizeUsgsFeature` above and `normalizeEmscFeature` below (same
 * `Event` shape, same skip-not-throw contract) but reads the pipe-column
 * row shape geofon.ts parsed (geofon-schema.ts) — this is the ONLY place
 * GEOFON column semantics may appear outside `geofon.ts`/`geofon-schema.ts`
 * (PROJECT.md gotcha).
 *
 * GEOFON-specific notes:
 * - No PAGER-equivalent alert data → the alert bonus in `computeClientSig`
 *   is always 0, same accepted asymmetry as EMSC (see below): it only
 *   matters while an event is GEOFON-only, and a USGS/EMSC record (once one
 *   appears) supersedes it via the merge's priority order (merge.ts).
 * - `magType` passes through untouched (mb, M, Mw(mB), ...): the internal
 *   model deliberately does not normalize magnitude type codes. GEOFON's
 *   regional intermediate-depth events (e.g. the verified gfz2026oyxe:
 *   mb 4.48 at 55 km under Iraq) arrive exactly as reported.
 * - The FDSN text format carries NO provider-update timestamp (nothing like
 *   USGS `updated`/EMSC `lastupdate`) → `providerUpdatedAt` falls back to
 *   the origin time, the same fallback normalizeEmscFeature uses for an
 *   unparseable `lastupdate`.
 * - Times are ISO 8601 WITHOUT a zone designator, UTC per the FDSN spec —
 *   see `parseFdsnTextTimeUtc` above; an unparseable time drops the row
 *   (origin time is load-bearing), counted by the caller, never thrown.
 */
export function normalizeGeofonRow(row: GeofonRow, fetchedAt: number): Event | null {
  const originTime = parseFdsnTextTimeUtc(row.time);
  if (Number.isNaN(originTime)) {
    return null;
  }

  const event: Event = {
    id: row.eventId,
    // See `normalizeUsgsFeature`'s own comment above — same "never
    // fabricated at parse time" rule applies to every feed normalizer.
    bumelerzeId: null,
    originTime,
    lat: row.latitude,
    lon: row.longitude,
    depthKm: row.depthKm,
    magnitude: {
      value: row.magnitude,
      type: row.magType.length > 0 ? row.magType : "unknown",
    },
    placeName: row.locationName,
    provenance: {
      provider: "geofon",
      providerId: row.eventId,
      fetchedAt,
      providerUpdatedAt: originTime,
    },
    // No `alert` argument — see the GEOFON-specific note above.
    sig: computeClientSig(row.magnitude, null),
    isRegional: isInRegionBbox(row.latitude, row.longitude),
    // The FDSN text response carries no per-event page URL; GEOFON's own
    // event-detail page follows this documented pattern.
    url: `https://geofon.gfz.de/event/${row.eventId}`,
  };

  return event;
}

export function normalizeEmscFeature(
  feature: EmscFeature,
  fetchedAt: number,
): Event | null {
  const { properties } = feature;

  // EMSC emits `mag: null` for not-yet-located/reviewed events, same
  // convention as USGS's pending-review placeholder — not yet usable.
  if (properties.mag === null) {
    return null;
  }

  const originTime = Date.parse(properties.time);
  if (Number.isNaN(originTime)) {
    return null;
  }

  const parsedUpdated = Date.parse(properties.lastupdate);
  const providerUpdatedAt = Number.isNaN(parsedUpdated) ? originTime : parsedUpdated;

  const event: Event = {
    id: properties.unid,
    // See `normalizeUsgsFeature`'s own comment above — same rule.
    bumelerzeId: null,
    originTime,
    lat: properties.lat,
    lon: properties.lon,
    depthKm: properties.depth,
    magnitude: {
      value: properties.mag,
      type: properties.magtype ?? "unknown",
    },
    placeName: properties.flynn_region ?? "",
    provenance: {
      provider: "emsc",
      providerId: properties.unid,
      fetchedAt,
      providerUpdatedAt,
    },
    // No `alert` argument — see the EMSC-specific note above.
    sig: computeClientSig(properties.mag, null),
    isRegional: isInRegionBbox(properties.lat, properties.lon),
    // EMSC's fdsnws response carries no per-event page URL field (unlike
    // USGS's `properties.url`); seismicportal.eu's own event-detail page
    // follows this documented pattern (teardown-lastquake.md §2).
    url: `https://www.seismicportal.eu/eventdetails.html?unid=${properties.unid}`,
  };

  return event;
}

/** `Event.provenance.provider` is deliberately narrow (`usgs`|`emsc`|
 * `geofon` — the app's own three LIVE feed sources, `types.ts`). A
 * Supabase-registered event may have been first sighted through a wider
 * provider set (`isc`, `iscgem`, `afad`, `manual`, ... — migration 0023's
 * widened `event_source_records_provider_check`), including every one of
 * the 11 curated Historical events, whose USGS ComCat ids simply happen to
 * carry an `iscgem`-shaped string (`notable-events.ts`'s own header
 * comment: "every id below is a real USGS ComCat/fdsnws event id"). Only
 * fields structurally typed as `EventProvider` (dedup cache keys, the
 * `events.provenance.${provider}` i18n tag lookup) need the narrowed value;
 * the true raw provider string is preserved verbatim for display via
 * `Event.placeName`'s own Source-section citation, never lost. */
const KNOWN_EVENT_PROVIDERS: readonly EventProvider[] = ["usgs", "emsc", "geofon"];

function toEventProvider(raw: string): EventProvider {
  return (KNOWN_EVENT_PROVIDERS as readonly string[]).includes(raw)
    ? (raw as EventProvider)
    : "usgs";
}

/**
 * `public.events_with_sources` row (+ its earliest `event_source_records`
 * sighting, migration 0023) -> internal `Event` — the Supabase-row
 * counterpart of `normalizeUsgsFeature`/`normalizeEmscFeature`/
 * `normalizeGeofonRow` above: same "normalize once at the boundary" rule
 * (this file's own header comment), for the one source those three don't
 * cover — a `/event/[id]` cold-start bml-id visit no cached feed knows
 * (`supabase-event.ts`'s `fetchSupabaseEventByBumelerzeId`, the only
 * caller). `primarySource` is `null` for the rare row with no readable
 * `event_source_records` sighting at all (RLS-hidden/deleted, or a
 * genuinely source-less manual entry) — falls back to a `"usgs"`
 * placeholder provider tag and the event's own uuid as a last-resort
 * provider id, so the `Event` this produces is still fully usable (never a
 * partial/nullable shape leaking into the rest of the app), just without a
 * real provider citation.
 */
export function normalizeSupabaseEventRow(
  row: EventsWithSourcesRow,
  primarySource: PrimarySourceRow | null,
): Event {
  const originTime = Date.parse(row.origin_time);
  const updatedAt = Date.parse(row.updated_at);
  const magnitudeValue = row.magnitude;

  return {
    id: primarySource?.provider_event_id ?? row.event_id,
    bumelerzeId: row.bumelerze_id,
    originTime: Number.isNaN(originTime) ? Date.now() : originTime,
    lat: row.lat,
    lon: row.lon,
    depthKm: row.depth_km ?? 0,
    magnitude: {
      value: magnitudeValue,
      type: row.mag_type ?? "unknown",
    },
    placeName: row.place ?? "",
    provenance: {
      provider: toEventProvider(primarySource?.provider ?? "usgs"),
      providerId: primarySource?.provider_event_id ?? row.event_id,
      fetchedAt: Date.now(),
      providerUpdatedAt: Number.isNaN(updatedAt) ? Date.now() : updatedAt,
    },
    // No PAGER-equivalent alert field on a Supabase-registered row (same
    // "no alert data" case `normalizeGeofonRow`/`normalizeEmscFeature`
    // already document) — the sig score still reflects the real magnitude.
    sig: computeClientSig(magnitudeValue, null),
    isRegional: isInRegionBbox(row.lat, row.lon),
    // No provider event-page URL survives a registry round trip (the raw
    // per-provider payload lives in `event_source_records.raw_payload`,
    // never selected here — bandwidth-cheap, same reasoning
    // `events_with_sources`' own doc comment gives for omitting it).
    url: "",
  };
}
