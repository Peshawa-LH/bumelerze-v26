// Orchestrates ingesting ONE channel's already-fetched records into the
// database. Deliberately takes a `Db` interface (not a live Supabase
// client) so this — the part of the pipeline the wave brief's tests
// specifically ask for ("the per-agency source-record write, the
// corroboration count, dedup across three sources producing one event with
// three source records, and the per-field derivation choosing the expected
// source") — is exercisable under Jest with a small in-memory fake, no
// live Postgres required. `index.ts` is the only caller that wires this to
// the real `db.ts` functions against a live service-role client.
//
// Per-record tolerance: one record's failure (a transient DB error, an
// unexpected RPC rejection) is caught, counted, and logged — it must never
// abort the rest of the channel's batch, same "partial progress beats an
// all-or-nothing failure" contract `aggregate-felt-cells/index.ts`'s own
// per-event loop already documents for this exact reason.

import { deriveCanonicalFields, type DerivedFields } from "./derivation.ts";
import { sourceRecordChanged } from "./matching.ts";
import type {
  ChannelFetchResult,
  ChannelIngestSummary,
  RawSourceRecord,
  RecordResult,
  StoredSourceRecord,
} from "./types.ts";

export interface Db {
  findSourceRecord(provider: string, providerEventId: string): Promise<StoredSourceRecord | null>;
  updateSourceRecord(sourceRecordId: string, record: RawSourceRecord): Promise<void>;
  /** First-sight path: resolves/creates the canonical event (via the
   * existing `upsert_event_from_client` RPC in the real implementation) and
   * writes this record's own `event_source_records` row. Returns the
   * canonical `event_id`. */
  createSourceRecordViaEventRegistry(record: RawSourceRecord): Promise<string>;
  fetchSourceRecordsForEvent(eventId: string): Promise<StoredSourceRecord[]>;
  applyDerivedFields(eventId: string, derived: DerivedFields | null): Promise<void>;
}

async function recomputeDerivation(db: Db, eventId: string): Promise<void> {
  const sourceRecords = await db.fetchSourceRecordsForEvent(eventId);
  const derived = deriveCanonicalFields(sourceRecords);
  await db.applyDerivedFields(eventId, derived);
}

async function ingestOneRecord(db: Db, record: RawSourceRecord): Promise<RecordResult> {
  const existing = await db.findSourceRecord(record.provider, record.providerEventId);

  if (existing) {
    if (!sourceRecordChanged(existing, record)) {
      return {
        outcome: "unchanged",
        provider: record.provider,
        providerEventId: record.providerEventId,
        eventId: existing.eventId,
      };
    }
    await db.updateSourceRecord(existing.sourceRecordId, record);
    await recomputeDerivation(db, existing.eventId);
    return {
      outcome: "updated",
      provider: record.provider,
      providerEventId: record.providerEventId,
      eventId: existing.eventId,
    };
  }

  const eventId = await db.createSourceRecordViaEventRegistry(record);
  await recomputeDerivation(db, eventId);
  return {
    outcome: "created",
    provider: record.provider,
    providerEventId: record.providerEventId,
    eventId,
  };
}

export async function ingestChannel(
  fetchResult: ChannelFetchResult,
  db: Db,
): Promise<ChannelIngestSummary> {
  const results: RecordResult[] = [];
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let errors = 0;

  for (const record of fetchResult.records) {
    try {
      const result = await ingestOneRecord(db, record);
      results.push(result);
      if (result.outcome === "created") created += 1;
      else if (result.outcome === "updated") updated += 1;
      else if (result.outcome === "unchanged") unchanged += 1;
    } catch (error) {
      errors += 1;
      results.push({
        outcome: "error",
        provider: record.provider,
        providerEventId: record.providerEventId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    channel: fetchResult.channel,
    fetched: fetchResult.records.length,
    skippedParsing: fetchResult.skippedCount,
    created,
    updated,
    unchanged,
    errors,
    results,
  };
}
