// aggregate-felt-cells — Supabase Edge Function (Deno).
//
// Recomputes `felt_cells` rows (CDI aggregates) for one event, or sweeps
// every event with felt reports in a recent lookback window, using the
// vendored copy of `src/lib/felt-aggregation/` (see that folder's
// `answer-types.ts` for the vendoring story) for the actual per-cell CDI
// math — this file's own job is I/O, request validation, cell grouping,
// and the idempotent skip-if-unchanged write path (`aggregate-event.ts`).
//
// Invocation (HTTP POST, service-role auth internal to the function — see
// `db.ts`'s `createServiceRoleClient`):
//   POST /functions/v1/aggregate-felt-cells
//   { "eventId": "<uuid>" }                 -- recompute just this event
//   { "sinceHours": 48 }                    -- sweep events with reports in
//                                               the last 48h (default 24)
//   {}                                      -- sweep, default 24h lookback
//
// Response: `{ "data": { "requestId": ..., "results": [...] } }` on
// success, `{ "error": { "code", "message", "requestId", "details"? } }`
// on failure (standardized envelope, matches the project's other
// client-facing surfaces' error-shape convention).
//
// Idempotency: re-invoking with the SAME underlying report data — whether
// because the caller retried after a dropped response, or a sweep
// re-selects an event nothing new happened to — writes nothing new
// (`aggregate-event.ts`'s `cellRowUnchanged`); a >=60s debounce
// (felt-report-science-v1.md §3.2 step 5) additionally skips an event
// outright if it was JUST recomputed. See `README.md` in this folder for
// the fuller design notes (grouping, p6 trigger, pg_cron alternative).
//
// Trigger wiring (not this wave): the natural production trigger is a
// Postgres webhook (Database Webhooks, Supabase's own pg_net-backed
// feature) on `felt_reports`/`felt_report_details` INSERT, POSTing
// `{ "eventId": NEW.event_id }` here — or a `pg_cron` schedule calling the
// sweep mode every few minutes. Both are one-line Supabase dashboard/SQL
// config once a project exists to configure them against; wiring either up
// is explicitly left to the orchestrator (task brief: "the orchestrator
// will schedule it later").

import { z } from "npm:zod@3.25.76";

import {
  createServiceRoleClient,
  fetchAllCellVersionsForEvent,
  fetchDetailsForReports,
  fetchEventIdsWithRecentReports,
  fetchReportsForEvent,
  insertCellVersion,
} from "./db.ts";
import {
  cellRowUnchanged,
  computeCellRow,
  groupIntoCells,
  isDebounced,
  joinReportsAndDetails,
  pickLatestPerGeohash,
} from "./aggregate-event.ts";
import type { FeltCellInsertRow } from "./types.ts";

const DEFAULT_SWEEP_LOOKBACK_HOURS = 24;
const MAX_SWEEP_LOOKBACK_HOURS = 24 * 30; // 30 days — generous but bounded

const RequestSchema = z
  .object({
    eventId: z.string().uuid().optional(),
    sinceHours: z.number().positive().max(MAX_SWEEP_LOOKBACK_HOURS).optional(),
  })
  .strict();

interface EventResult {
  eventId: string;
  debounced: boolean;
  cellsComputed: number;
  cellsWritten: number;
  cellsUnchanged: number;
}

async function aggregateOneEvent(
  // deno-lint-ignore no-explicit-any
  client: any,
  eventId: string,
): Promise<EventResult> {
  const existingRows = await fetchAllCellVersionsForEvent(client, eventId);

  const latestComputedAt = existingRows.reduce<string | null>(
    (max, row) => (max === null || row.computed_at > max ? row.computed_at : max),
    null,
  );
  if (isDebounced(latestComputedAt)) {
    return { eventId, debounced: true, cellsComputed: 0, cellsWritten: 0, cellsUnchanged: 0 };
  }

  const reports = await fetchReportsForEvent(client, eventId);
  if (reports.length === 0) {
    return { eventId, debounced: false, cellsComputed: 0, cellsWritten: 0, cellsUnchanged: 0 };
  }

  const details = await fetchDetailsForReports(
    client,
    reports.map((r) => r.report_id),
  );
  const cellReports = joinReportsAndDetails(reports, details);
  const groups = groupIntoCells(cellReports);
  const latestByGeohash = pickLatestPerGeohash(existingRows);

  let written = 0;
  let unchanged = 0;
  for (const group of groups) {
    const existing = latestByGeohash.get(group.geohash);
    const nextVersion = existing ? existing.version + 1 : 1;
    const computed: FeltCellInsertRow | null = computeCellRow(eventId, group, nextVersion);
    if (!computed) {
      continue;
    }
    if (cellRowUnchanged(computed, existing)) {
      unchanged += 1;
      continue;
    }
    await insertCellVersion(client, computed);
    written += 1;
  }

  return {
    eventId,
    debounced: false,
    cellsComputed: groups.length,
    cellsWritten: written,
    cellsUnchanged: unchanged,
  };
}

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

  try {
    const client = createServiceRoleClient();
    const eventIds = parsed.data.eventId
      ? [parsed.data.eventId]
      : await fetchEventIdsWithRecentReports(
          client,
          parsed.data.sinceHours ?? DEFAULT_SWEEP_LOOKBACK_HOURS,
        );

    log("info", requestId, "starting", {
      eventCount: eventIds.length,
      mode: parsed.data.eventId ? "single" : "sweep",
    });

    const results: EventResult[] = [];
    for (const eventId of eventIds) {
      try {
        const result = await aggregateOneEvent(client, eventId);
        results.push(result);
        log("info", requestId, "event done", result);
      } catch (err) {
        // One bad event must not abort the whole sweep — same "tolerant of
        // partial failure" spirit as the feed-ingestion function's own
        // brief ("tolerant of feed downtime and duplicate events"):
        // partial progress beats an all-or-nothing failure for a batch job
        // like this.
        log("error", requestId, "event failed", {
          eventId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return new Response(JSON.stringify({ data: { requestId, results } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    log("error", requestId, "unhandled error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return jsonError(500, "internal_error", "Unexpected error.", requestId);
  }
});
