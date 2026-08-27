/**
 * Integration-style tests for the orchestration layer, against an in-memory
 * `Db` fake — no live Postgres involved (per the wave brief: prove idempotency
 * and dedup as unit tests, not against a running Supabase project).
 *
 * `FakeDb.createSourceRecordViaEventRegistry` deliberately re-implements
 * the SAME dedup rule `upsert_event_from_client` (migrations 0011/0012)
 * applies in Postgres, using this function's own ported `findMatchingEvent`
 * (matching.ts) — proving that when `ingest-channel.ts` is wired to
 * something that behaves like the real RPC, three different-provider
 * sightings of one physical earthquake end up as one event with three
 * source records, exactly what the real pipeline is expected to do.
 */

import { corroborationCount } from "../corroboration";
import { deriveCanonicalFields } from "../derivation";
import { ingestChannel, type Db } from "../ingest-channel";
import { findMatchingEvent } from "../matching";
import type {
  CandidateEvent,
  ChannelFetchResult,
  DerivedFields,
  RawSourceRecord,
  StoredSourceRecord,
} from "../types";

class FakeDb implements Db {
  private events = new Map<string, CandidateEvent>();
  private sourceRecords = new Map<string, StoredSourceRecord>();
  private byProviderKey = new Map<string, string>(); // "provider:providerEventId" -> sourceRecordId
  private nextEventId = 1;
  private nextSourceId = 1;
  private clockMs = 1_700_000_000_000;

  private key(provider: string, providerEventId: string): string {
    return `${provider}:${providerEventId}`;
  }

  async findSourceRecord(provider: string, providerEventId: string) {
    const id = this.byProviderKey.get(this.key(provider, providerEventId));
    return id ? (this.sourceRecords.get(id) ?? null) : null;
  }

  async updateSourceRecord(sourceRecordId: string, record: RawSourceRecord) {
    const existing = this.sourceRecords.get(sourceRecordId);
    if (!existing) throw new Error(`updateSourceRecord: unknown id ${sourceRecordId}`);
    this.clockMs += 1;
    this.sourceRecords.set(sourceRecordId, {
      ...existing,
      parsedOriginTimeMs: record.originTimeMs,
      parsedLat: record.lat,
      parsedLon: record.lon,
      parsedDepthKm: record.depthKm,
      parsedMagnitude: record.magnitude,
      parsedMagType: record.magType,
      parsedPlace: record.place,
      authorAgency: record.authorAgency,
      magnitudeAuthor: record.magnitudeAuthor,
      reviewStatus: record.reviewStatus,
      fetchedAtMs: this.clockMs,
    });
  }

  async createSourceRecordViaEventRegistry(record: RawSourceRecord) {
    const candidates = Array.from(this.events.values());
    const match = findMatchingEvent(candidates, record);
    const eventId = match ? match.eventId : `event-${this.nextEventId++}`;
    if (!match) {
      this.events.set(eventId, {
        eventId,
        originTimeMs: record.originTimeMs,
        lat: record.lat,
        lon: record.lon,
        magnitude: record.magnitude,
      });
    }

    this.clockMs += 1;
    const sourceRecordId = `src-${this.nextSourceId++}`;
    const stored: StoredSourceRecord = {
      sourceRecordId,
      eventId,
      provider: record.provider,
      providerEventId: record.providerEventId,
      parsedOriginTimeMs: record.originTimeMs,
      parsedLat: record.lat,
      parsedLon: record.lon,
      parsedDepthKm: record.depthKm,
      parsedMagnitude: record.magnitude,
      parsedMagType: record.magType,
      parsedPlace: record.place,
      authorAgency: record.authorAgency,
      magnitudeAuthor: record.magnitudeAuthor,
      reviewStatus: record.reviewStatus,
      fetchedAtMs: this.clockMs,
    };
    this.sourceRecords.set(sourceRecordId, stored);
    this.byProviderKey.set(this.key(record.provider, record.providerEventId), sourceRecordId);
    return eventId;
  }

  async fetchSourceRecordsForEvent(eventId: string) {
    return Array.from(this.sourceRecords.values()).filter((r) => r.eventId === eventId);
  }

  async applyDerivedFields(eventId: string, derived: DerivedFields | null) {
    if (derived === null) return;
    const event = this.events.get(eventId);
    if (!event) throw new Error(`applyDerivedFields: unknown event ${eventId}`);
    this.events.set(eventId, {
      ...event,
      originTimeMs: derived.originTimeMs,
      lat: derived.lat,
      lon: derived.lon,
      magnitude: derived.magnitude ?? event.magnitude,
    });
  }

  // Test-only helpers, not part of the `Db` interface:
  eventCount(): number {
    return this.events.size;
  }
  getEvent(eventId: string): CandidateEvent | undefined {
    return this.events.get(eventId);
  }
}

function baseRecord(overrides: Partial<RawSourceRecord>): RawSourceRecord {
  return {
    provider: "emsc",
    providerEventId: "emsc-1",
    rawPayload: {},
    originTimeMs: 1_700_000_000_000,
    lat: 36.19,
    lon: 44.01,
    depthKm: 10,
    magnitude: 4.0,
    magType: "ml",
    place: "Erbil",
    authorAgency: "EMSC",
    magnitudeAuthor: "EMSC",
    reviewStatus: "automatic",
    providerUpdatedAtMs: 1_700_000_000_000,
    ...overrides,
  };
}

function fetchResult(
  channel: ChannelFetchResult["channel"],
  records: RawSourceRecord[],
  skippedCount = 0,
): ChannelFetchResult {
  return { channel, records, skippedCount };
}

describe("ingestChannel — per-agency source-record write", () => {
  it("creates one event and one event_source_records row for a brand-new physical earthquake", async () => {
    const db = new FakeDb();
    const summary = await ingestChannel(fetchResult("emsc", [baseRecord({})]), db);

    expect(summary.created).toBe(1);
    expect(summary.updated).toBe(0);
    expect(summary.errors).toBe(0);
    expect(db.eventCount()).toBe(1);

    const eventId = summary.results[0]?.eventId as string;
    const sources = await db.fetchSourceRecordsForEvent(eventId);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.provider).toBe("emsc");
    expect(sources[0]?.authorAgency).toBe("EMSC");
  });
});

describe("ingestChannel — dedup across three sources produces one event with three source records", () => {
  it("merges USGS, EMSC and GEOFON sightings of the SAME physical earthquake into one event", async () => {
    const db = new FakeDb();

    const emscRecord = baseRecord({
      provider: "emsc",
      providerEventId: "emsc-1",
      authorAgency: "EMSC",
      magnitudeAuthor: "EMSC",
    });
    const usgsRecord = baseRecord({
      provider: "usgs",
      providerEventId: "us-1",
      originTimeMs: emscRecord.originTimeMs + 3_000, // within the 16s window
      lat: emscRecord.lat + 0.01, // within the 100km window
      magnitude: emscRecord.magnitude + 0.2, // within the 1.5 window
      authorAgency: "US",
      magnitudeAuthor: "US",
    });
    const geofonRecord = baseRecord({
      provider: "geofon",
      providerEventId: "gfz-1",
      originTimeMs: emscRecord.originTimeMs - 5_000,
      lon: emscRecord.lon - 0.02,
      authorAgency: "GFZ",
      magnitudeAuthor: "GFZ",
    });

    const emscSummary = await ingestChannel(fetchResult("emsc", [emscRecord]), db);
    const usgsSummary = await ingestChannel(fetchResult("usgs", [usgsRecord]), db);
    const geofonSummary = await ingestChannel(fetchResult("geofon", [geofonRecord]), db);

    expect(emscSummary.created).toBe(1);
    expect(usgsSummary.created).toBe(1);
    expect(geofonSummary.created).toBe(1);
    expect(db.eventCount()).toBe(1); // NOT three separate events

    const eventId = emscSummary.results[0]?.eventId as string;
    expect(usgsSummary.results[0]?.eventId).toBe(eventId);
    expect(geofonSummary.results[0]?.eventId).toBe(eventId);

    const sources = await db.fetchSourceRecordsForEvent(eventId);
    expect(sources).toHaveLength(3);
    expect(new Set(sources.map((s) => s.provider))).toEqual(new Set(["emsc", "usgs", "geofon"]));

    // "located by EMSC, US and GFZ" — 3 independent corroborating agencies.
    expect(corroborationCount(sources)).toBe(3);
  });

  it("does NOT merge a record outside the dedup thresholds — two separate events", async () => {
    const db = new FakeDb();
    const first = baseRecord({ provider: "emsc", providerEventId: "emsc-1" });
    const farAway = baseRecord({ provider: "usgs", providerEventId: "us-2", lon: first.lon + 5 });

    await ingestChannel(fetchResult("emsc", [first]), db);
    await ingestChannel(fetchResult("usgs", [farAway]), db);

    expect(db.eventCount()).toBe(2);
  });
});

describe("ingestChannel — idempotency", () => {
  it("replaying the exact same fetch result writes nothing new the second time", async () => {
    const db = new FakeDb();
    const record = baseRecord({});

    const first = await ingestChannel(fetchResult("emsc", [record]), db);
    const second = await ingestChannel(fetchResult("emsc", [record]), db);

    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
    expect(second.unchanged).toBe(1);
    expect(db.eventCount()).toBe(1);

    const eventId = first.results[0]?.eventId as string;
    const sources = await db.fetchSourceRecordsForEvent(eventId);
    expect(sources).toHaveLength(1); // not duplicated
  });

  it("a genuine revision (magnitude updated) is written once as an update, not a duplicate", async () => {
    const db = new FakeDb();
    const record = baseRecord({});
    const revised = { ...record, magnitude: 4.4, reviewStatus: "reviewed" as const };

    const first = await ingestChannel(fetchResult("emsc", [record]), db);
    const second = await ingestChannel(fetchResult("emsc", [revised]), db);

    expect(second.updated).toBe(1);
    expect(second.created).toBe(0);

    const eventId = first.results[0]?.eventId as string;
    const sources = await db.fetchSourceRecordsForEvent(eventId);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.parsedMagnitude).toBe(4.4);
    expect(sources[0]?.reviewStatus).toBe("reviewed");
  });
});

describe("ingestChannel — per-field derivation choosing the expected source", () => {
  it("re-derives the event's canonical location to the nearest-network agency once it arrives", async () => {
    const db = new FakeDb();

    const emscFirst = baseRecord({
      provider: "emsc",
      providerEventId: "emsc-1",
      authorAgency: "EMSC",
      magnitudeAuthor: "EMSC",
      lat: 36.2,
    });
    const isnLater = baseRecord({
      provider: "isc",
      providerEventId: "isc-1",
      authorAgency: "ISN",
      magnitudeAuthor: "ISN",
      lat: 36.19, // slightly different — the ISN-authored location should win
      originTimeMs: emscFirst.originTimeMs + 1_000,
    });

    const emscSummary = await ingestChannel(fetchResult("emsc", [emscFirst]), db);
    await ingestChannel(fetchResult("isc", [isnLater]), db);

    const eventId = emscSummary.results[0]?.eventId as string;
    const finalEvent = db.getEvent(eventId);
    expect(finalEvent?.lat).toBe(36.19); // ISN's location, not EMSC's

    // Cross-check directly against the derivation module used to produce it.
    const sources = await db.fetchSourceRecordsForEvent(eventId);
    const derived = deriveCanonicalFields(sources);
    expect(derived?.lat).toBe(36.19);
  });
});

describe("ingestChannel — per-record error tolerance", () => {
  it("one record's failure does not abort the rest of the batch", async () => {
    const db = new FakeDb();
    const failingProviderEventId = "emsc-bad";
    // NOTE: cannot `{...db, findSourceRecord: ...}` here — `db` is a class
    // instance whose methods live on its prototype (not own enumerable
    // properties), so an object spread would silently drop every method
    // except the one explicitly overridden. Delegate each one explicitly
    // instead.
    const partiallyFailingDb: Db = {
      findSourceRecord: (provider, providerEventId) => {
        if (providerEventId === failingProviderEventId) {
          throw new Error("boom");
        }
        return db.findSourceRecord(provider, providerEventId);
      },
      updateSourceRecord: (sourceRecordId, record) => db.updateSourceRecord(sourceRecordId, record),
      createSourceRecordViaEventRegistry: (record) => db.createSourceRecordViaEventRegistry(record),
      fetchSourceRecordsForEvent: (eventId) => db.fetchSourceRecordsForEvent(eventId),
      applyDerivedFields: (eventId, derived) => db.applyDerivedFields(eventId, derived),
    };
    const ok = baseRecord({ provider: "usgs", providerEventId: "us-ok" });
    const bad = baseRecord({ provider: "emsc", providerEventId: failingProviderEventId });

    const summary = await ingestChannel(fetchResult("usgs", [bad, ok]), partiallyFailingDb);

    expect(summary.errors).toBe(1);
    expect(summary.created).toBe(1);
    expect(summary.results).toHaveLength(2);
    expect(summary.results[0]).toMatchObject({ outcome: "error", providerEventId: "emsc-bad" });
    expect(summary.results[1]).toMatchObject({ outcome: "created", providerEventId: "us-ok" });
  });
});
