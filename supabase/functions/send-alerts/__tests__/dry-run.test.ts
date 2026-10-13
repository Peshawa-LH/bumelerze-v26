/**
 * Delivery dry run in testers mode, end to end through the sender (Stage 2):
 * a regional earthquake reaches the testers' devices and nobody else's, and
 * the notification opens https://app.bumelerze.com/event/<Bumelerze id>.
 *
 * PLAN below is what alert_plan_run() of migration 0062 returned in a real
 * Postgres (PGlite, 2026-10-13) for: mode testers; a tester on the allowlist
 * (Chrome, English), the official account holding alerts.test (Safari,
 * Sorani) and a member of the public (Chrome), all with "near me" M3+ at
 * Hawler; a published, verified M4.6 at 36.1 N 44.2 E five minutes old.
 * The public device got no delivery; with the mode switched to public the
 * same kind of event did reach it, so the rollout gate, not distance or tier,
 * kept it out. The SQL assertions at the end pin that gate in the migration.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { runInNewContext } from "vm";

import { APP_ORIGIN } from "@/config/urls";

import { functionSource, readCode } from "../../../migrations/sql-test-utils";
import { parsePlan } from "../plan";
import { runSendAlerts } from "../run";
import { createExpoSender, createWebSender, type DeliveryResult, type FetchLike, type GenerateRequestDetails } from "../senders";

const TESTER_DEVICE = "https://fcm.googleapis.com/fcm/send/tester-device";
const OFFICIAL_DEVICE = "https://web.push.apple.com/official-device";
const PUBLIC_DEVICE = "https://fcm.googleapis.com/fcm/send/public-device";

const target = (endpoint: string) => ({
  auth: "AAAAAAAAAAAAAAAAAAAAAA",
  kind: "web",
  p256dh: `B${"P".repeat(86)}`,
  endpoint,
});
const EVENT = {
  id: "bml2026abcd",
  lat: 36.1,
  lon: 44.2,
  depth_km: 10,
  magnitude: 4.6,
  origin_time: "2026-10-13T18:36:43.405+00:00",
};
const PLAN = {
  mode: "testers",
  run_id: "f71c855c-e236-4b6d-8750-034791519d88",
  deliveries: [
    {
      id: "5b73fe46-0819-418c-905c-77b0e775b27e",
      kind: "alert",
      event: EVENT,
      locale: "en",
      target: target(TESTER_DEVICE),
      attempt: 1,
      context: "near_me",
      summary_count: null,
      previous_magnitude: null,
    },
    {
      id: "370a197b-1e44-4d92-9e35-21386ba12c6a",
      kind: "alert",
      event: EVENT,
      locale: "ckb",
      target: target(OFFICIAL_DEVICE),
      attempt: 1,
      context: "near_me",
      summary_count: null,
      previous_magnitude: null,
    },
  ],
};

/** Runs one send with the real web sender; the encryption and network are fakes. */
async function dryRun(plan: unknown) {
  const pushes: { endpoint: string; payload: Record<string, unknown>; topic: string; urgency: string }[] = [];
  const generate: GenerateRequestDetails = (sub, payload, options) => {
    pushes.push({ endpoint: sub.endpoint, payload: JSON.parse(payload), topic: options.topic, urgency: options.urgency });
    return { method: "POST", endpoint: sub.endpoint, headers: { TTL: options.TTL }, body: "encrypted" };
  };
  const fetch: FetchLike = async () => ({ status: 201, text: async () => "", json: async () => ({}) });
  const recorded: { runId: string; results: DeliveryResult[] }[] = [];
  let calls = 0;
  const summary = await runSendAlerts(
    {
      async plan() {
        calls += 1;
        return calls === 1 ? plan : { run_id: null, mode: "testers", deliveries: [] };
      },
      async record(runId, results) {
        recorded.push({ runId, results });
      },
    },
    {
      web: createWebSender({ generate, fetch, vapid: { subject: "mailto:dev@bumelerze.com", publicKey: "p", privateKey: "k" } }),
      expo: createExpoSender({ fetch }),
    },
  );
  return { pushes, recorded, summary };
}

/** public/push-sw.js in a sandbox served from the app's root. */
function serviceWorker() {
  const source = readFileSync(join(__dirname, "../../../../public/push-sw.js"), "utf8");
  const listeners: Record<string, (event: Record<string, unknown>) => void> = {};
  const shown: { title: string; options: { data: { url: string }; dir: string; lang: string } }[] = [];
  const opened: string[] = [];
  const self = {
    registration: {
      scope: `${APP_ORIGIN}/`,
      showNotification: (title: string, options: (typeof shown)[number]["options"]) => {
        shown.push({ title, options });
        return Promise.resolve();
      },
    },
    location: { origin: APP_ORIGIN },
    skipWaiting: () => undefined,
    clients: {
      claim: () => Promise.resolve(),
      matchAll: () => Promise.resolve([]),
      openWindow: (url: string) => {
        opened.push(url);
        return Promise.resolve(null);
      },
    },
    addEventListener: (type: string, fn: (event: Record<string, unknown>) => void) => {
      listeners[type] = fn;
    },
  };
  runInNewContext(source, { self, Date });
  async function deliver(payload: Record<string, unknown>) {
    const waits: Promise<unknown>[] = [];
    const waitUntil = (p: Promise<unknown>) => waits.push(p);
    listeners.push?.({ data: { json: () => payload }, waitUntil });
    await Promise.all(waits);
    const notification = shown[shown.length - 1];
    listeners.notificationclick?.({ notification: { close: () => undefined, data: notification?.options.data }, waitUntil });
    await Promise.all(waits);
    return { notification, opened: opened[opened.length - 1] };
  }
  return { deliver };
}

describe("dry run: a regional earthquake in testers mode", () => {
  it("the planner's batch goes to the two tester devices only", () => {
    const parsed = parsePlan(PLAN);
    expect(parsed.mode).toBe("testers");
    expect(parsed.invalid).toEqual([]);
    expect(parsed.items.map((item) => item.target.kind === "web" && item.target.endpoint)).toEqual([
      TESTER_DEVICE,
      OFFICIAL_DEVICE,
    ]);
    expect(JSON.stringify(PLAN)).not.toContain(PUBLIC_DEVICE);
  });

  it("sends one push per tester device and records both as sent", async () => {
    const { pushes, recorded, summary } = await dryRun(PLAN);
    expect(pushes.map((p) => p.endpoint)).toEqual([TESTER_DEVICE, OFFICIAL_DEVICE]);
    expect(pushes.every((p) => p.urgency === "high" && p.topic === "ev-bml2026abcd")).toBe(true);
    expect(summary).toMatchObject({ mode: "testers", claimed: 2, sent: 2, failed: 0 });
    expect(recorded).toEqual([
      {
        runId: PLAN.run_id,
        results: [
          { delivery_id: PLAN.deliveries[0]?.id, outcome: "sent" },
          { delivery_id: PLAN.deliveries[1]?.id, outcome: "sent" },
        ],
      },
    ]);
  });

  it("the notification names our place, in each device's language, and links to the event", async () => {
    const { pushes } = await dryRun(PLAN);
    const [en, ckb] = pushes;
    expect(en?.payload).toMatchObject({ path: "event/bml2026abcd", lang: "en", dir: "ltr" });
    expect(String(en?.payload.title)).toContain("4.6");
    expect(String(en?.payload.body)).toContain("Hawler");
    expect(ckb?.payload).toMatchObject({ path: "event/bml2026abcd", lang: "ckb", dir: "rtl" });
    expect(String(ckb?.payload.title)).toContain("٤.٦");
  });

  it("tapping it opens https://app.bumelerze.com/event/<Bumelerze id> (the root, no /app)", async () => {
    const { pushes } = await dryRun(PLAN);
    const sw = serviceWorker();
    const { notification, opened } = await sw.deliver(pushes[0]?.payload ?? {});
    expect(notification?.options.data.url).toBe("https://app.bumelerze.com/event/bml2026abcd");
    expect(opened).toBe("https://app.bumelerze.com/event/bml2026abcd");
    expect(APP_ORIGIN).toBe("https://app.bumelerze.com");
  });

  it("a test alert opens the Notifications screen at the root", async () => {
    const plan = {
      mode: "testers",
      run_id: PLAN.run_id,
      deliveries: [{ ...PLAN.deliveries[0], kind: "test", event: null, context: null }],
    };
    const { pushes } = await dryRun(plan);
    expect(pushes[0]?.payload).toMatchObject({ path: "notification-settings", title: "Test alert" });
    const { opened } = await serviceWorker().deliver(pushes[0]?.payload ?? {});
    expect(opened).toBe("https://app.bumelerze.com/notification-settings");
  });
});

describe("the gate behind the dry run (migration 0062)", () => {
  const sql = readCode("0062_alert_sender.sql");

  it("devices are planned only for people eligible in the current mode", () => {
    expect(functionSource(sql, "alert_plan_event")).toContain("and public.alert_user_eligible(ps.user_id, p_mode)");
  });

  it("testers mode = alerts.test or the allowlist; public = everyone; off = nobody", () => {
    const eligible = functionSource(sql, "alert_user_eligible");
    expect(eligible).toContain("when 'testers' then public.alert_is_tester(p_user)");
    expect(eligible).toContain("when 'public' then p_user is not null");
    expect(eligible).toContain("else false");
    const tester = functionSource(sql, "alert_is_tester");
    expect(tester).toContain("exists (select 1 from public.alert_testers t where t.user_id = p_user)");
    expect(tester).toContain("public.has_permission(p_user, 'alerts.test')");
  });

  it("a delivery carries the Bumelerze id the app's /event/<id> route reads", () => {
    expect(functionSource(sql, "alert_plan_run")).toContain("'id', e.bumelerze_id");
  });
});
