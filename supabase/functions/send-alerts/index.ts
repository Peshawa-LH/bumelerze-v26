// send-alerts — Supabase Edge Function (Deno). Migration 0062.
//
// Delivers earthquake alerts. pg_cron (job send_alerts) posts here every
// minute while public.alert_work_pending() says there is work. The database
// decides everything (rollout gate off | testers | public, who is near, tiers,
// one alert per event per device, the aftershock guard, the 3-an-hour cap);
// this function only sends what alert_plan_run() hands it and reports back
// through alert_record_results().
//
// Request: POST, body {} or { "limit": 1..500 }. It takes NO targeting input
// (no event, no person, no device), so anyone calling it can only make it
// drain the queue sooner. Deploy with verify_jwt off, like purge-home-photos:
//   supabase functions deploy send-alerts --no-verify-jwt
// Response: { "data": { requestId, rounds, mode, claimed, sent, gone, retry, failed } }
// or { "error": { code, message, requestId } }.
//
// Secrets (Edge Function secrets, never in the repo):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT  web push (required)
//   EXPO_ACCESS_TOKEN                                    Expo push (optional)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.

import { createClient } from "npm:@supabase/supabase-js@2.112.2";
import webpush from "npm:web-push@3.6.7";
import { z } from "npm:zod@3.25.76";

import { runSendAlerts } from "./run.ts";
import {
  createExpoSender,
  createWebSender,
  type DeliveryResult,
  type FetchLike,
  type GenerateRequestDetails,
} from "./senders.ts";

const RequestSchema = z
  .object({ limit: z.number().int().min(1).max(500).optional() })
  .strict();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonError(status: number, code: string, message: string, requestId: string): Response {
  return json(status, { error: { code, message, requestId } });
}

function log(level: "info" | "error", requestId: string, msg: string, extra?: unknown): void {
  const line = JSON.stringify({ fn: "send-alerts", level, requestId, msg, ...(extra ? { extra } : {}) });
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
  if (text.trim() !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      return jsonError(400, "invalid_json", "Request body must be valid JSON.", requestId);
    }
  }
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid request.", requestId);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT");
  if (!url || !key || !vapidPublic || !vapidPrivate || !vapidSubject) {
    // Nothing is claimed, so nothing is lost: the queue waits for the secrets.
    log("error", requestId, "missing SUPABASE_* or VAPID_* environment");
    return jsonError(500, "misconfigured", "Function environment is incomplete.", requestId);
  }
  const client = createClient(url, key, { auth: { persistSession: false } });
  const doFetch = fetch as unknown as FetchLike;

  const senders = {
    web: createWebSender({
      generate: webpush.generateRequestDetails as unknown as GenerateRequestDetails,
      fetch: doFetch,
      vapid: { subject: vapidSubject, publicKey: vapidPublic, privateKey: vapidPrivate },
    }),
    expo: createExpoSender({ fetch: doFetch, accessToken: Deno.env.get("EXPO_ACCESS_TOKEN") ?? null }),
  };

  try {
    const summary = await runSendAlerts(
      {
        async plan(limit) {
          const { data, error } = await client.rpc("alert_plan_run", { p_limit: limit });
          if (error) throw new Error(`alert_plan_run: ${error.message}`);
          return data;
        },
        async record(runId: string, results: DeliveryResult[]) {
          const { error } = await client.rpc("alert_record_results", {
            p_run_id: runId,
            p_results: results,
          });
          if (error) throw new Error(`alert_record_results: ${error.message}`);
          const failures = results.filter((r) => r.outcome !== "sent");
          if (failures.length > 0) {
            log("info", requestId, "not delivered", {
              runId,
              results: failures.slice(0, 20).map((r) => ({ id: r.delivery_id, outcome: r.outcome, error: r.error })),
            });
          }
        },
      },
      senders,
      { limit: parsed.data.limit ?? 200 },
    );
    log(summary.failed > 0 ? "error" : "info", requestId, "send finished", summary);
    return json(200, { data: { requestId, ...summary } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("error", requestId, "send failed", { message });
    return jsonError(500, "send_failed", message, requestId);
  }
});
