import { z } from "zod";

import { getSupabaseClient } from "@/lib/supabase";

import {
  ALERT_MODES,
  AlertsError,
  type AlertAccess,
  type AlertMode,
  type AlertPreferencesPayload,
  type AlertsOverview,
  type WebPushKeys,
} from "./types";

/**
 * Alert RPCs (migration 0062). Every table behind them is closed to the app;
 * these functions are the only way in. Tests inject a fake `AlertsTransport`.
 */
export interface AlertsTransport {
  fetchAccess(): Promise<AlertAccess>;
  registerWebPush(keys: WebPushKeys, locale: string): Promise<void>;
  unregisterWebPush(endpoint: string): Promise<void>;
  savePreferences(payload: AlertPreferencesPayload): Promise<void>;
  /** Returns how many of my devices it goes to. */
  sendTest(): Promise<number>;
  fetchOverview(): Promise<AlertsOverview>;
  setMode(mode: AlertMode): Promise<AlertsOverview>;
  addTester(username: string): Promise<AlertsOverview>;
  removeTester(userId: string): Promise<AlertsOverview>;
}

const modeSchema = z.enum(["off", "testers", "public"]).catch("testers");

const accessSchema = z.object({
  mode: modeSchema,
  tester: z.boolean().catch(false),
  enabled: z.boolean().catch(false),
  can_manage: z.boolean().catch(false),
});

const count = z.coerce.number().int().nonnegative().catch(0);

const overviewSchema = z.object({
  mode: modeSchema,
  can_manage: z.boolean().catch(false),
  devices: count,
  waiting: count,
  testers: z
    .array(
      z.object({
        user_id: z.string(),
        username: z.string().nullable().optional(),
        display_name: z.string().nullable().optional(),
        via: z.enum(["allowlist", "rank"]).catch("allowlist"),
        devices: count,
      }),
    )
    .catch([]),
  runs: z
    .array(
      z.object({
        run_id: z.string(),
        started_at: z.string(),
        mode: z.string().catch(""),
        events: count,
        planned: count,
        suppressed: count,
        claimed: count,
        sent: count,
        failed: count,
        gone: count,
      }),
    )
    .catch([]),
});

export function parseAccess(data: unknown): AlertAccess {
  const parsed = accessSchema.safeParse(data);
  if (!parsed.success) {
    throw new AlertsError("unknown", "alerts_my_access returned an unexpected shape");
  }
  return {
    mode: parsed.data.mode,
    tester: parsed.data.tester,
    enabled: parsed.data.enabled,
    canManage: parsed.data.can_manage,
  };
}

export function parseOverview(data: unknown): AlertsOverview {
  const parsed = overviewSchema.safeParse(data);
  if (!parsed.success) {
    throw new AlertsError("unknown", "admin_alerts_overview returned an unexpected shape");
  }
  const o = parsed.data;
  return {
    mode: o.mode,
    canManage: o.can_manage,
    devices: o.devices,
    waiting: o.waiting,
    testers: o.testers.map((t) => ({
      userId: t.user_id,
      username: t.username ?? null,
      displayName: t.display_name ?? null,
      via: t.via,
      devices: t.devices,
    })),
    runs: o.runs.map((r) => ({
      runId: r.run_id,
      startedAt: Date.parse(r.started_at),
      mode: r.mode,
      events: r.events,
      planned: r.planned,
      suppressed: r.suppressed,
      claimed: r.claimed,
      sent: r.sent,
      failed: r.failed,
      gone: r.gone,
    })),
  };
}

interface ErrorLike {
  code?: string;
  message?: string;
}

/** Maps the server's error tokens (`fn: token`) to a code the UI can word. */
export function toAlertsError(error: unknown): AlertsError {
  if (error instanceof AlertsError) {
    return error;
  }
  const e: ErrorLike = typeof error === "object" && error !== null ? (error as ErrorLike) : {};
  const message = e.message ?? String(error);
  const tokens: [RegExp, AlertsError["code"]][] = [
    [/:\s*not_signed_in\b/, "not_signed_in"],
    [/:\s*not_enabled\b/, "not_enabled"],
    [/:\s*not_allowed\b/, "not_allowed"],
    [/:\s*not_found\b/, "not_found"],
    [/:\s*too_soon\b/, "too_soon"],
    [/:\s*no_device\b/, "no_device"],
    [/:\s*too_many_devices\b/, "too_many_devices"],
    [/:\s*(endpoint|key|token|tier|place|mode)_invalid\b/, "invalid"],
  ];
  for (const [pattern, code] of tokens) {
    if (pattern.test(message)) {
      return new AlertsError(code, message);
    }
  }
  // The migration is not applied yet: PostgREST does not know the function.
  if (e.code === "PGRST202" || /Could not find the function/i.test(message)) {
    return new AlertsError("unavailable", message);
  }
  if (/fetch|network|timed? ?out/i.test(message)) {
    return new AlertsError("network", message);
  }
  return new AlertsError("unknown", message);
}

async function call(name: string, args?: Record<string, unknown>): Promise<unknown> {
  const client = getSupabaseClient();
  if (!client) {
    throw new AlertsError("unavailable", "Supabase is not configured");
  }
  try {
    const { data, error } = await client.rpc(name, args);
    if (error) {
      throw toAlertsError(error);
    }
    return data;
  } catch (error) {
    throw toAlertsError(error);
  }
}

export function isAlertMode(value: unknown): value is AlertMode {
  return ALERT_MODES.includes(value as AlertMode);
}

export const SupabaseAlertsTransport: AlertsTransport = {
  async fetchAccess() {
    return parseAccess(await call("alerts_my_access"));
  },
  async registerWebPush(keys, locale) {
    await call("alerts_register_web_push", {
      p_endpoint: keys.endpoint,
      p_p256dh: keys.p256dh,
      p_auth: keys.auth,
      p_locale: locale,
    });
  },
  async unregisterWebPush(endpoint) {
    await call("alerts_unregister_push", { p_endpoint: endpoint, p_expo_token: null });
  },
  async savePreferences(p) {
    await call("alerts_save_preferences", {
      p_near_me_tier: p.nearMeTier,
      p_near_me_lat: p.nearMeLat,
      p_near_me_lon: p.nearMeLon,
      p_another_tier: p.anotherTier,
      p_another_lat: p.anotherLat,
      p_another_lon: p.anotherLon,
      p_language: p.language,
    });
  },
  async sendTest() {
    const data = await call("alerts_send_test");
    return typeof data === "number" ? data : 0;
  },
  async fetchOverview() {
    return parseOverview(await call("admin_alerts_overview"));
  },
  async setMode(mode) {
    return parseOverview(await call("admin_alerts_set_mode", { p_mode: mode }));
  },
  async addTester(username) {
    return parseOverview(await call("admin_alert_tester_add", { p_username: username }));
  },
  async removeTester(userId) {
    return parseOverview(await call("admin_alert_tester_remove", { p_user: userId }));
  },
};
