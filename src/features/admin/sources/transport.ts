import { z } from "zod";

import { call } from "../transport";

/**
 * What the admin home's "Source status" card shows
 * (`admin_source_status()`, migrations 0070 and 0072, `stats.read` only):
 * every feed the server ingests, how long ago it last delivered, whether it
 * is late, the operations alert open for it, and the SHAKEmap worker's start
 * (absent before 0072). Times are epoch milliseconds.
 */
export const SOURCE_PROVIDERS = ["usgs", "emsc", "geofon", "isc"] as const;
export type SourceProvider = (typeof SOURCE_PROVIDERS)[number];

export interface SourceRow {
  provider: SourceProvider;
  lastOkAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
  late: boolean;
  thresholdMinutes: number;
  alertOpenedAt: number | null;
}

export interface OpenAlert {
  kind: string;
  provider: string | null;
  openedAt: number;
}

export type WorkerOutcome = "sent" | "ok" | "failed" | "no_token";

export interface WorkerLine {
  tokenSet: boolean;
  pending: boolean;
  lastDispatchedAt: number | null;
  lastOutcome: WorkerOutcome | null;
  lastStatus: number | null;
  lastError: string | null;
  failures: number;
}

export interface SourceStatus {
  checkedAt: number | null;
  sources: SourceRow[];
  openAlerts: OpenAlert[];
  /** Null before migration 0072 (no worker start from the registry yet). */
  worker: WorkerLine | null;
}

function time(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

const text = z.string().nullable().optional().catch(null);
const sourceSchema = z.object({
  provider: z.enum(SOURCE_PROVIDERS),
  last_ok_at: text,
  last_error_at: text,
  last_error: text,
  late: z.boolean().catch(false),
  threshold_minutes: z.coerce.number().int().positive().catch(60),
  alert_opened_at: text,
});
const alertSchema = z.object({
  kind: z.string(),
  provider: text,
  opened_at: z.string(),
});
const workerSchema = z.object({
  token_set: z.boolean().catch(false),
  pending: z.boolean().catch(false),
  last_dispatched_at: text,
  last_outcome: z
    .enum(["sent", "ok", "failed", "no_token"])
    .nullable()
    .optional()
    .catch(null),
  last_status: z.coerce.number().int().nullable().optional().catch(null),
  last_error: text,
  failures: z.coerce.number().int().nonnegative().catch(0),
});

export function parseSourceStatus(data: unknown): SourceStatus {
  const root = (data ?? {}) as Record<string, unknown>;
  const sources: SourceRow[] = [];
  for (const row of Array.isArray(root.sources) ? root.sources : []) {
    const parsed = sourceSchema.safeParse(row);
    if (!parsed.success) {
      continue;
    }
    const d = parsed.data;
    sources.push({
      provider: d.provider,
      lastOkAt: time(d.last_ok_at),
      lastErrorAt: time(d.last_error_at),
      lastError: d.last_error ?? null,
      late: d.late,
      thresholdMinutes: d.threshold_minutes,
      alertOpenedAt: time(d.alert_opened_at),
    });
  }
  const openAlerts: OpenAlert[] = [];
  for (const row of Array.isArray(root.open_alerts) ? root.open_alerts : []) {
    const parsed = alertSchema.safeParse(row);
    const openedAt = parsed.success ? time(parsed.data.opened_at) : null;
    if (parsed.success && openedAt !== null) {
      openAlerts.push({
        kind: parsed.data.kind,
        provider: parsed.data.provider ?? null,
        openedAt,
      });
    }
  }
  const worker = workerSchema.safeParse(root.shake_worker);
  return {
    checkedAt: time(typeof root.checked_at === "string" ? root.checked_at : null),
    sources,
    openAlerts,
    worker: worker.success
      ? {
          tokenSet: worker.data.token_set,
          pending: worker.data.pending,
          lastDispatchedAt: time(worker.data.last_dispatched_at),
          lastOutcome: worker.data.last_outcome ?? null,
          lastStatus: worker.data.last_status ?? null,
          lastError: worker.data.last_error ?? null,
          failures: worker.data.failures,
        }
      : null,
  };
}

export interface SourceStatusTransport {
  fetchSourceStatus(): Promise<SourceStatus>;
}

export const SupabaseSourceStatusTransport: SourceStatusTransport = {
  async fetchSourceStatus() {
    return parseSourceStatus(await call("admin_source_status"));
  },
};
