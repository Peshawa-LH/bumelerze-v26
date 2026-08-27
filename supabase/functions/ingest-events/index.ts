// ingest-events — Supabase Edge Function (Deno).
//
// Scheduled (pg_cron + pg_net, same wiring as `aggregate-felt-cells` —
// migration 0024) server-side poller for the four buildable channels
// (source-and-ingestion-plan.md §5): EMSC/USGS every 60s, GEOFON every 5
// min, ISC once daily. Replaces every phone polling every agency directly
// (~180,000 requests/hour at 1,000 users) with three requests/minute plus
// one daily bulletin sweep, from one server — the client's own direct-fetch
// path (`src/features/events/`) is UNCHANGED and stays wired as the
// fallback for when this backend is unreachable (wave brief: "a Supabase
// outage does not leave people without earthquake data during an
// earthquake").
//
// Invocation (HTTP POST):
//   POST /functions/v1/ingest-events
//   { "channel": "emsc" | "usgs" | "geofon" | "isc" }
//
// Response: `{ "data": { "requestId", "summary": ChannelIngestSummary } }`
// on success, `{ "error": { "code", "message", "requestId", "details"? } }`
// on failure — same standardized envelope as `aggregate-felt-cells`.
//
// Idempotency: proven at three layers (see `README.md` for the fuller
// story) — (1) `event_source_records`' own (provider, provider_event_id)
// unique index, (2) `matching.ts`'s `sourceRecordChanged` skip-if-unchanged
// check (a re-fetch of an unrevised record writes nothing), (3)
// `upsert_event_from_client`'s own existing idempotent-retry short-circuit.
// Replaying the exact same channel fetch twice in a row produces the exact
// same database state, never a duplicate event or a duplicate source
// record.

import { z } from "npm:zod@3.25.76";

import { CHANNELS, isChannelId } from "./channels.ts";
import {
  applyDerivedFields,
  createServiceRoleClient,
  createSourceRecordViaEventRegistry,
  fetchSourceRecordsForEvent,
  findSourceRecord,
  updateSourceRecord,
} from "./db.ts";
import { ingestChannel, type Db } from "./ingest-channel.ts";

const RequestSchema = z
  .object({
    channel: z.string().min(1),
  })
  .strict();

function jsonError(
  status: number,
  code: string,
  message: string,
  requestId: string,
  details?: unknown,
): Response {
  return new Response(
    JSON.stringify({ error: { code, message, requestId, ...(details ? { details } : {}) } }),
    { status, headers: { "content-type": "application/json" } },
  );
}

function log(level: "info" | "error", requestId: string, msg: string, extra?: unknown): void {
  const line = JSON.stringify({ level, requestId, msg, ...(extra ? { extra } : {}) });
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();

  if (req.method !== "POST") {
    return jsonError(405, "method_not_allowed", "Only POST is supported.", requestId);
  }

  let body: unknown = {};
  const text = await req.text();
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      return jsonError(400, "invalid_json", "Request body must be valid JSON.", requestId);
    }
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      400,
      "invalid_request",
      "Request failed validation.",
      requestId,
      parsed.error.flatten(),
    );
  }

  if (!isChannelId(parsed.data.channel)) {
    return jsonError(
      400,
      "unknown_channel",
      `Unknown channel "${parsed.data.channel}". Known channels: ${Object.keys(CHANNELS).join(", ")}.`,
      requestId,
    );
  }
  const channelDef = CHANNELS[parsed.data.channel];

  try {
    const fetchResult = await channelDef.fetch(Date.now());
    log("info", requestId, "fetched", {
      channel: fetchResult.channel,
      fetched: fetchResult.records.length,
      skippedParsing: fetchResult.skippedCount,
    });

    const client = createServiceRoleClient();
    const db: Db = {
      findSourceRecord: (provider, providerEventId) =>
        findSourceRecord(client, provider, providerEventId),
      updateSourceRecord: (sourceRecordId, record) =>
        updateSourceRecord(client, sourceRecordId, record),
      createSourceRecordViaEventRegistry: (record) =>
        createSourceRecordViaEventRegistry(client, record),
      fetchSourceRecordsForEvent: (eventId) => fetchSourceRecordsForEvent(client, eventId),
      applyDerivedFields: (eventId, derived) => applyDerivedFields(client, eventId, derived),
    };

    const summary = await ingestChannel(fetchResult, db);
    log("info", requestId, "done", {
      channel: summary.channel,
      created: summary.created,
      updated: summary.updated,
      unchanged: summary.unchanged,
      errors: summary.errors,
    });

    return new Response(JSON.stringify({ data: { requestId, summary } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    // A whole-channel failure (feed unreachable, HTTP error after the
    // bounded retry in http.ts is exhausted, malformed top-level payload) —
    // logged and reported, never thrown past this handler. The next
    // scheduled cron tick for this channel is the retry (see http.ts's own
    // header comment on why this function does not itself build a longer
    // backoff loop).
    log("error", requestId, "channel failed", {
      channel: channelDef.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return jsonError(
      502,
      "channel_fetch_failed",
      `Channel "${channelDef.id}" failed: ${err instanceof Error ? err.message : String(err)}`,
      requestId,
    );
  }
});
