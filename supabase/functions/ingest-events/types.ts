// Shared types for the ingest-events Edge Function. Deno-flavored (explicit
// `.ts` relative imports) like aggregate-felt-cells's own types.ts — no
// runtime dependency, safe to import from both Deno code and this folder's
// Jest tests (see that function's __tests__ for the precedent).

/** The provider allow-list this function knows how to fetch, minus the two
 * reserved-but-not-yet-buildable channels (`kur`: direct Kurdistan/Iraq
 * national feed pending an agreement; `bumelerze-crowd`: written directly by
 * `detect_possible_events`, migration 0012, never by this function). Both
 * are already representable in `event_source_records.provider` (migration
 * 0012 / 0023) without a further schema change — the wave brief's "two
 * reserved slots" requirement. Adding a FIFTH buildable channel means: one
 * more value here, one more `ChannelDefinition` in `channels.ts`, one more
 * `cron.schedule(...)` call — never touching this file's callers.
 */
export type ChannelId = "emsc" | "usgs" | "geofon" | "isc";

/** One channel's declared cadence — documentation + the value each
 * `cron.schedule` call in the migration is expected to match. Not read at
 * runtime by this function (pg_cron owns the actual schedule); kept here so
 * `channels.ts` has ONE place that states "how often should this run",
 * checkable against the SQL migration in review. */
export type ChannelCadence =
  | { kind: "live"; intervalSeconds: number }
  | { kind: "bulletin"; times: "daily" };

/**
 * One parsed record from one provider's feed, BEFORE it is matched against
 * `events` or written to `event_source_records`. This is the ingester's
 * internal normalized shape — deliberately NOT the client's `Event` type
 * (`src/features/events/types.ts`): the client model already discards
 * exactly the fields this function exists to capture (author agency,
 * magnitude author, review status) — see source-and-ingestion-plan.md §5.1/
 * §6.2 and this folder's README for why a fresh, richer shape is used
 * instead of reusing/widening the client one.
 *
 * Tolerant-parsing contract (matches every existing provider adapter in
 * `src/features/events/`): an adapter that cannot produce a valid
 * `RawSourceRecord` for a given feed entry (missing magnitude, unparseable
 * time, malformed row) skips it and counts it — never throws for a single
 * bad record. Only a top-level fetch/parse failure (HTTP error, not-JSON-at-
 * all body) throws, exactly like `usgs.ts`/`emsc.ts`/`geofon.ts`.
 */
export interface RawSourceRecord {
  /** Catalog polled to get this record — matches
   * `event_source_records.provider`'s CHECK allow-list. */
  provider: ChannelId;
  /** The provider's own event id — matches
   * `event_source_records.provider_event_id`, unique per provider. */
  providerEventId: string;
  /** Verbatim (or, for the pipe-delimited FDSN text format, a parsed
   * key/value reconstruction — see `fdsn-text-adapter.ts`) provider payload,
   * kept forever per migration 0002's own "raw_payload... kept forever (D13
   * provenance)". */
  rawPayload: Record<string, unknown>;

  originTimeMs: number;
  lat: number;
  lon: number;
  depthKm: number | null;
  /** Always present — every adapter skips a magnitude-less feature entry
   * before it ever becomes a `RawSourceRecord` (same convention as the
   * client's own `normalizeUsgsFeature`/`normalizeEmscFeature`: a
   * placeholder/pending-review null magnitude makes a feature "not yet
   * usable", counted as skipped, never carried through). This is also what
   * lets `ingest-channel.ts` safely call `upsert_event_from_client` (which
   * itself rejects a null magnitude) for every genuinely new record without
   * a second null-check at the call site. */
  magnitude: number;
  magType: string | null;
  place: string | null;

  /** WHO located this (origin/time/depth) — independent of `provider`. Null
   * when the feed exposes no attribution at all. */
  authorAgency: string | null;
  /** WHO authored the magnitude value specifically — usually equal to
   * `authorAgency`, but genuinely differs on ISC bulletin rows (verified
   * live, e.g. ISC event 643726562: Author=AFAD, MagAuthor=ISK). Falls back
   * to `authorAgency` in adapters that only expose one attribution field
   * (USGS `net`, EMSC `auth`). */
  magnitudeAuthor: string | null;

  reviewStatus: "automatic" | "reviewed";
  /** Provider's own last-modified timestamp when the feed exposes one
   * (USGS `updated`, EMSC `lastupdate`); falls back to `originTimeMs` for
   * the FDSN text providers (GEOFON/ISC carry no revision timestamp at
   * all — same fallback the client's own `normalizeGeofonRow` uses). NOT
   * used as the sole change-detection signal by this function (see
   * `matching.ts`'s `sourceRecordChanged` doc comment for why) — carried
   * through purely as provenance, matching
   * `event_source_records.provider_updated_at`'s existing column comment.
   */
  providerUpdatedAtMs: number;
}

/** A previously-stored `event_source_records` row, as read back from the DB
 * for change-detection and for derivation — the subset of columns
 * `matching.ts`/`derivation.ts` need, independent of supabase-js's own
 * row typing so those modules stay a plain, dependency-free pure-function
 * layer (same separation aggregate-felt-cells draws between `types.ts` and
 * `db.ts`). */
export interface StoredSourceRecord {
  sourceRecordId: string;
  eventId: string;
  provider: string;
  providerEventId: string;
  parsedOriginTimeMs: number;
  parsedLat: number;
  parsedLon: number;
  parsedDepthKm: number | null;
  parsedMagnitude: number | null;
  parsedMagType: string | null;
  parsedPlace: string | null;
  authorAgency: string | null;
  magnitudeAuthor: string | null;
  reviewStatus: "automatic" | "reviewed" | "deleted";
  fetchedAtMs: number;
}

/** A minimal, already-canonical event — the candidate set `matching.ts`
 * compares each incoming `RawSourceRecord` against. Deliberately narrow
 * (only what the spatial-temporal-magnitude match needs). */
export interface CandidateEvent {
  eventId: string;
  originTimeMs: number;
  lat: number;
  lon: number;
  magnitude: number | null;
}

export interface ChannelFetchResult {
  channel: ChannelId;
  records: RawSourceRecord[];
  /** Feed entries present in the response but skipped (tolerant-parsing
   * contract above). */
  skippedCount: number;
}

export type RecordOutcome = "created" | "updated" | "unchanged" | "error";

export interface RecordResult {
  outcome: RecordOutcome;
  provider: ChannelId;
  providerEventId: string;
  eventId?: string;
  error?: string;
}

export interface ChannelIngestSummary {
  channel: ChannelId;
  fetched: number;
  skippedParsing: number;
  created: number;
  updated: number;
  unchanged: number;
  errors: number;
  results: RecordResult[];
}
