// send-alerts — Supabase Edge Function (Deno). Migration 0062.
//
// Delivers earthquake alerts. pg_cron (job send_alerts) posts here every
// minute while public.alert_work_pending() says there is work. The database
// decides everything (rollout gate off | testers | public, who is near, tiers,
// one alert per event per device, the aftershock guard, the 3-an-hour cap);
// this function only sends what alert_plan_run() hands it and reports back
// through alert_record_results().
//
// This file is the ENTRYPOINT: it only wires Deno, the database and the push
// services into handler.ts, which holds the request rules:
//   GET or POST {"health": true}  -> { data: { requestId, mode, keys } }
//                                    keys = "ok" | "mismatch" | "missing"
//   POST {} or { "limit": 1..500 } -> { data: { requestId, keys, rounds, mode,
//                                    claimed, sent, gone, retry, failed } }
// or { "error": { code, message, requestId } }. Before sending, the public key
// is derived from VAPID_PRIVATE_KEY and compared with VAPID_PUBLIC_KEY and the
// app's key (app-key.ts, vapid-check.ts); on any difference nothing is sent.
//
// It takes NO targeting input (no event, no person, no device), so anyone
// calling it can only make it drain the queue sooner. Deploy with verify_jwt
// off, like purge-home-photos:
//   supabase functions deploy send-alerts --no-verify-jwt
//
// Secrets (Edge Function secrets, never in the repo):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT  web push (required)
//   EXPO_ACCESS_TOKEN                                    Expo push (optional)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.112.2";
import webpush from "npm:web-push@3.6.7";

import { APP_VAPID_PUBLIC_KEY } from "./app-key.ts";
import { handleRequest, type HandlerDeps } from "./handler.ts";
import { runSendAlerts } from "./run.ts";
import {
  createExpoSender,
  createWebSender,
  type DeliveryResult,
  type FetchLike,
  type GenerateRequestDetails,
} from "./senders.ts";
import { createKeyChecker } from "./vapid-check.ts";

// Once per isolate: the derivation is only redone when a secret changes.
const checkKeys = createKeyChecker(APP_VAPID_PUBLIC_KEY);

function log(level: "info" | "error", requestId: string, msg: string, extra?: unknown): void {
  const line = JSON.stringify({ fn: "send-alerts", level, requestId, msg, ...(extra ? { extra } : {}) });
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

let cachedClient: SupabaseClient | null = null;
function client(): SupabaseClient {
  if (!cachedClient) {
    cachedClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );
  }
  return cachedClient;
}

function deps(requestId: string): HandlerDeps {
  return {
    env: (name) => Deno.env.get(name),
    requestId: () => requestId,
    checkKeys,
    log,
    async readMode() {
      const { data, error } = await client()
        .from("alert_settings")
        .select("mode")
        .eq("key", "rollout")
        .maybeSingle();
      if (error || !data) return "unknown";
      return typeof data.mode === "string" ? data.mode : "unknown";
    },
    async run(limit, vapid) {
      const db = client();
      const doFetch = fetch as unknown as FetchLike;
      const senders = {
        web: createWebSender({
          generate: webpush.generateRequestDetails as unknown as GenerateRequestDetails,
          fetch: doFetch,
          vapid,
        }),
        expo: createExpoSender({ fetch: doFetch, accessToken: Deno.env.get("EXPO_ACCESS_TOKEN") ?? null }),
      };
      return runSendAlerts(
        {
          async plan(batch) {
            const { data, error } = await db.rpc("alert_plan_run", { p_limit: batch });
            if (error) throw new Error(`alert_plan_run: ${error.message}`);
            return data;
          },
          async record(runId: string, results: DeliveryResult[]) {
            const { error } = await db.rpc("alert_record_results", {
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
        { limit },
      );
    },
  };
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const text = req.method === "POST" ? await req.text() : "";
  const result = await handleRequest(req.method, text, deps(requestId));
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { "Content-Type": "application/json" },
  });
});
