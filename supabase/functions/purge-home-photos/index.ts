// purge-home-photos — Supabase Edge Function (Deno). Migration 0061.
//
// Removes the photo FILES of deleted homes from the private `home-photos`
// bucket. Postgres cannot delete storage objects, so the database queues the
// tag id of every deleted home whose folder still has files
// (`home_photo_purge`, filled by the `home_tags_after_delete` trigger) and
// this function drains that queue through the Storage API. pg_cron calls it
// nightly at 04:15 UTC (job `purge_home_photos`, same call shape as the
// aggregate-felt-cells job of 0017).
//
// Request: POST, body `{}` or `{ "limit": 1..100 }` (tags per call).
// Response: `{ "data": { requestId, removed, done, failed, folders } }`, or
// `{ "error": { code, message, requestId } }`.
//
// Safe for anyone to call: it takes no ids from the caller, only drains the
// queue, and re-running it does nothing new. Deploy like aggregate-felt-cells
// (`supabase functions deploy purge-home-photos --no-verify-jwt`), because the
// cron job sends the publishable key, which is not a JWT.

import { createClient } from "npm:@supabase/supabase-js@2.112.2";
import { z } from "npm:zod@3.25.76";

import { purgeHomePhotos, type PurgePorts } from "./purge.ts";

const BUCKET = "home-photos";

const RequestSchema = z
  .object({ limit: z.number().int().min(1).max(100).optional() })
  .strict();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonError(
  status: number,
  code: string,
  message: string,
  requestId: string,
): Response {
  return json(status, { error: { code, message, requestId } });
}

function log(
  level: "info" | "error",
  requestId: string,
  msg: string,
  extra?: unknown,
): void {
  const line = JSON.stringify({
    fn: "purge-home-photos",
    level,
    requestId,
    msg,
    ...(extra ? { extra } : {}),
  });
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
      return jsonError(
        400,
        "invalid_json",
        "Request body must be valid JSON.",
        requestId,
      );
    }
  }
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      400,
      "invalid_request",
      parsed.error.issues[0]?.message ?? "Invalid request.",
      requestId,
    );
  }

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    log("error", requestId, "missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return jsonError(
      500,
      "misconfigured",
      "Function environment is incomplete.",
      requestId,
    );
  }
  const client = createClient(url, key, { auth: { persistSession: false } });

  const ports: PurgePorts = {
    async nextQueued(limit) {
      const { data, error } = await client
        .from("home_photo_purge")
        .select("tag_id")
        .order("queued_at", { ascending: true })
        .limit(limit);
      if (error) throw new Error(`queue read failed: ${error.message}`);
      return (data ?? []).map((row: { tag_id: string }) => row.tag_id);
    },
    async listFiles(folder) {
      const { data, error } = await client.storage
        .from(BUCKET)
        .list(folder, { limit: 1000 });
      if (error) throw new Error(`list failed: ${error.message}`);
      // folders have no id; files do
      return (data ?? []).filter((item) => item.id !== null).map((item) => item.name);
    },
    async removeFiles(paths) {
      const { error } = await client.storage.from(BUCKET).remove(paths);
      if (error) throw new Error(`remove failed: ${error.message}`);
    },
    async markDone(tagIds) {
      const { error } = await client
        .from("home_photo_purge")
        .delete()
        .in("tag_id", tagIds);
      if (error) throw new Error(`queue update failed: ${error.message}`);
    },
  };

  try {
    const summary = await purgeHomePhotos(ports, { batch: parsed.data.limit ?? 25 });
    log(summary.failed > 0 ? "error" : "info", requestId, "purge finished", {
      removed: summary.removed,
      done: summary.done,
      failed: summary.failed,
    });
    return json(200, { data: { requestId, ...summary } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("error", requestId, "purge failed", { message });
    return jsonError(500, "purge_failed", message, requestId);
  }
});
