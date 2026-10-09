// Pure: checks what alert_plan_run() (migration 0062) handed back. Our own
// database is the only caller, but a delivery with a broken shape must never
// crash the run or loop forever: it is reported back as failed.

import { isAlertLocale, type AlertItem, type DeliveryKind } from "./message.ts";

export interface ParsedPlan {
  runId: string | null;
  mode: string;
  items: AlertItem[];
  /** Delivery ids that came back malformed (recorded as failed). */
  invalid: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BML = /^bml\d{4}[0-9a-z]{4,}$/;
const KINDS: readonly DeliveryKind[] = ["alert", "upgrade", "summary", "test"];

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function parseItem(raw: Row): AlertItem | null {
  const id = raw.id;
  const kind = raw.kind;
  if (typeof id !== "string" || !UUID.test(id)) return null;
  if (typeof kind !== "string" || !KINDS.includes(kind as DeliveryKind)) return null;

  const target = raw.target;
  if (!isRow(target)) return null;
  let parsedTarget: AlertItem["target"];
  if (
    target.kind === "web" &&
    typeof target.endpoint === "string" &&
    typeof target.p256dh === "string" &&
    typeof target.auth === "string"
  ) {
    parsedTarget = {
      kind: "web",
      endpoint: target.endpoint,
      p256dh: target.p256dh,
      auth: target.auth,
    };
  } else if (target.kind === "expo" && typeof target.token === "string") {
    parsedTarget = { kind: "expo", token: target.token };
  } else {
    return null;
  }

  let event: AlertItem["event"] = null;
  if (raw.event !== null && raw.event !== undefined) {
    const e = raw.event;
    if (!isRow(e)) return null;
    const magnitude = num(e.magnitude);
    const lat = num(e.lat);
    const lon = num(e.lon);
    if (
      typeof e.id !== "string" ||
      !BML.test(e.id) ||
      magnitude === null ||
      lat === null ||
      lon === null ||
      typeof e.origin_time !== "string"
    ) {
      return null;
    }
    event = {
      id: e.id,
      magnitude,
      originTime: e.origin_time,
      lat,
      lon,
      depthKm: num(e.depth_km),
    };
  }
  if (kind !== "test" && event === null) return null;

  const context = raw.context;
  return {
    id,
    kind: kind as DeliveryKind,
    locale: isAlertLocale(raw.locale) ? raw.locale : "en",
    context: context === "near_me" || context === "another_place" ? context : null,
    target: parsedTarget,
    event,
    previousMagnitude: num(raw.previous_magnitude),
    summaryCount: num(raw.summary_count),
    attempt: num(raw.attempt) ?? 1,
  };
}

export function parsePlan(raw: unknown): ParsedPlan {
  if (!isRow(raw)) {
    throw new Error("alert_plan_run returned no object");
  }
  const runId = typeof raw.run_id === "string" && UUID.test(raw.run_id) ? raw.run_id : null;
  const mode = typeof raw.mode === "string" ? raw.mode : "unknown";
  const items: AlertItem[] = [];
  const invalid: string[] = [];
  const list = Array.isArray(raw.deliveries) ? raw.deliveries : [];
  for (const entry of list) {
    const item = isRow(entry) ? parseItem(entry) : null;
    if (item) {
      items.push(item);
    } else if (isRow(entry) && typeof entry.id === "string" && UUID.test(entry.id)) {
      invalid.push(entry.id);
    }
  }
  return { runId, mode, items, invalid };
}
