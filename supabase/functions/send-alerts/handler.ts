// Pure request handling of send-alerts: what a call may ask, the key
// self-check, and the answer. No Deno, no npm imports: index.ts wires the
// real database and push senders in through `deps`, and Jest drives this file
// directly (__tests__/handler.test.ts).
//
// Calls:
//   GET, or POST {"health": true}
//       -> 200 { data: { requestId, mode, keys } }, no side effect at all.
//          mode: the rollout (off | testers | public | unknown);
//          keys: "ok" | "mismatch" | "missing" (never a key value).
//   POST {} or {"limit": 1..500}   (pg_cron sends {})
//       -> sends what alert_plan_run() hands out, unless the keys are not
//          "ok": then nothing is planned or claimed (the queue waits) and the
//          answer is 500 { error: { code: "vapid_keys", message, requestId } }.

import type { RunSummary } from "./run.ts";
import type { VapidKeys } from "./senders.ts";
import type { KeyCheck } from "./vapid-check.ts";

export interface HandlerResult {
  status: number;
  body: unknown;
}

export interface HandlerDeps {
  env(name: string): string | undefined;
  requestId(): string;
  checkKeys(publicKey: string | undefined, privateKey: string | undefined): KeyCheck;
  /** The rollout mode, read without side effects (health only). */
  readMode(): Promise<string>;
  /** One full send (plan, deliver, record), once everything is in order. */
  run(limit: number, vapid: VapidKeys): Promise<RunSummary>;
  log(level: "info" | "error", requestId: string, msg: string, extra?: unknown): void;
}

type Parsed = { ok: true; health: boolean; limit: number } | { ok: false; code: string; message: string };

/** {} | {"limit": 1..500} | {"health": true}; nothing else. */
export function parseRequest(method: string, text: string): Parsed {
  if (method === "GET") {
    return { ok: true, health: true, limit: 200 };
  }
  if (method !== "POST") {
    return { ok: false, code: "method_not_allowed", message: "Only GET (health) and POST are supported." };
  }
  let body: unknown = {};
  if (text.trim() !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: false, code: "invalid_json", message: "Request body must be valid JSON." };
    }
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, code: "invalid_request", message: "Request body must be an object." };
  }
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "limit" && key !== "health") {
      return { ok: false, code: "invalid_request", message: `Unknown field: ${key.slice(0, 40)}` };
    }
  }
  if (record.health !== undefined && record.health !== true) {
    return { ok: false, code: "invalid_request", message: "health must be true." };
  }
  const limit = record.limit;
  if (limit !== undefined && (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 500)) {
    return { ok: false, code: "invalid_request", message: "limit must be an integer from 1 to 500." };
  }
  return { ok: true, health: record.health === true, limit: typeof limit === "number" ? limit : 200 };
}

function error(status: number, code: string, message: string, requestId: string): HandlerResult {
  return { status, body: { error: { code, message, requestId } } };
}

export async function handleRequest(method: string, text: string, deps: HandlerDeps): Promise<HandlerResult> {
  const requestId = deps.requestId();
  const parsed = parseRequest(method, text);
  if (!parsed.ok) {
    return error(parsed.code === "method_not_allowed" ? 405 : 400, parsed.code, parsed.message, requestId);
  }

  const vapidPublic = deps.env("VAPID_PUBLIC_KEY");
  const vapidPrivate = deps.env("VAPID_PRIVATE_KEY");
  const vapidSubject = deps.env("VAPID_SUBJECT");
  const keys = deps.checkKeys(vapidPublic, vapidPrivate);
  const hasDatabase = Boolean(deps.env("SUPABASE_URL") && deps.env("SUPABASE_SERVICE_ROLE_KEY"));

  if (parsed.health) {
    let mode = "unknown";
    if (hasDatabase) {
      try {
        mode = await deps.readMode();
      } catch {
        mode = "unknown";
      }
    }
    return { status: 200, body: { data: { requestId, mode, keys } } };
  }

  if (!hasDatabase || !vapidSubject || keys === "missing") {
    // Nothing is claimed, so nothing is lost: the queue waits for the secrets.
    deps.log("error", requestId, "missing SUPABASE_* or VAPID_* environment", { keys });
    return error(500, "misconfigured", "Function environment is incomplete.", requestId);
  }
  if (keys !== "ok") {
    // Every push would be refused by the push services: send nothing.
    deps.log("error", requestId, "VAPID keys do not match; nothing sent", { keys });
    return error(
      500,
      "vapid_keys",
      "VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY and the app's public key do not match. Nothing was sent.",
      requestId,
    );
  }

  try {
    const summary = await deps.run(parsed.limit, {
      subject: vapidSubject,
      publicKey: vapidPublic ?? "",
      privateKey: vapidPrivate ?? "",
    });
    deps.log(summary.failed > 0 ? "error" : "info", requestId, "send finished", summary);
    return { status: 200, body: { data: { requestId, keys, ...summary } } };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    deps.log("error", requestId, "send failed", { message });
    return error(500, "send_failed", message, requestId);
  }
}
