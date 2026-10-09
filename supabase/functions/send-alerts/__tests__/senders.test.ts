/**
 * The push adapters with fakes: status codes become sent / gone / retry /
 * failed, unknown push hosts are never contacted, Expo tickets map one to one,
 * and a batch survives a sender that throws.
 */
import { buildMessage, type AlertItem } from "../message";
import { parsePlan } from "../plan";
import {
  classifyStatus,
  createExpoSender,
  createWebSender,
  deliverBatch,
  EXPO_PUSH_URL,
  isAllowedEndpoint,
  type FetchLike,
  type GenerateRequestDetails,
} from "../senders";
import { runSendAlerts } from "../run";

const EVENT = { id: "bml2026abcd", magnitude: 4.2, originTime: "x", lat: 36.2, lon: 44, depthKm: null };
let n = 0;
function webItem(endpoint = "https://fcm.googleapis.com/fcm/send/abc"): AlertItem {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    kind: "alert",
    locale: "en",
    context: "near_me",
    target: { kind: "web", endpoint, p256dh: "key", auth: "auth" },
    event: EVENT,
    previousMagnitude: null,
    summaryCount: null,
    attempt: 1,
  };
}
function expoItem(token = "ExponentPushToken[abcdefghijkl]"): AlertItem {
  return { ...webItem(), target: { kind: "expo", token } };
}

const generate: GenerateRequestDetails = (sub, payload, options) => ({
  method: "POST",
  endpoint: sub.endpoint,
  headers: { TTL: options.TTL, "Content-Length": 10, Urgency: options.urgency, Topic: options.topic },
  body: payload,
});

function fakeFetch(statusFor: (url: string) => number | Error) {
  const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    const status = statusFor(url);
    if (status instanceof Error) throw status;
    return { status, text: async () => "nope", json: async () => ({}) };
  };
  return { fetch, calls };
}

const vapid = { subject: "mailto:dev@bumelerze.com", publicKey: "pub", privateKey: "priv" };

describe("classifyStatus", () => {
  it.each([
    [201, "sent"],
    [200, "sent"],
    [404, "gone"],
    [410, "gone"],
    [429, "retry"],
    [500, "retry"],
    [503, "retry"],
    [408, "retry"],
    [400, "failed"],
    [403, "failed"],
    [413, "failed"],
  ])("%i -> %s", (status, outcome) => {
    expect(classifyStatus(status)).toBe(outcome);
  });
});

describe("isAllowedEndpoint", () => {
  it.each([
    ["https://fcm.googleapis.com/fcm/send/x", true],
    ["https://web.push.apple.com/QGx", true],
    ["https://updates.push.services.mozilla.com/wpush/v2/x", true],
    ["https://wns2-par02p.notify.windows.com/w/?token=x", true],
    ["http://fcm.googleapis.com/fcm/send/x", false],
    ["https://fcm.googleapis.com.evil.io/x", false],
    ["https://evil.example.com/push", false],
    ["https://localhost/x", false],
  ])("%s -> %s", (endpoint, allowed) => {
    expect(isAllowedEndpoint(endpoint)).toBe(allowed);
  });
});

describe("web sender", () => {
  it("sends with TTL, urgency and topic, without Content-Length", async () => {
    const { fetch, calls } = fakeFetch(() => 201);
    const send = createWebSender({ generate, fetch, vapid, now: () => 5 });
    const it1 = webItem();
    const result = await send(it1, buildMessage(it1));
    expect(result).toEqual({ delivery_id: it1.id, outcome: "sent" });
    expect(calls[0]?.headers).toEqual({ TTL: "1800", Urgency: "high", Topic: "ev-bml2026abcd" });
    expect(JSON.parse(String(calls[0]?.body)).ts).toBe(5);
  });

  it("maps 410 to gone, 503 to retry, 400 to failed, a network error to retry", async () => {
    const { fetch } = fakeFetch((url) =>
      url.endsWith("gone") ? 410 : url.endsWith("busy") ? 503 : url.endsWith("bad") ? 400 : new Error("offline"),
    );
    const send = createWebSender({ generate, fetch, vapid });
    const outcomes = [];
    for (const suffix of ["gone", "busy", "bad", "down"]) {
      const it1 = webItem(`https://fcm.googleapis.com/fcm/send/${suffix}`);
      outcomes.push((await send(it1, buildMessage(it1))).outcome);
    }
    expect(outcomes).toEqual(["gone", "retry", "failed", "retry"]);
  });

  it("never contacts an endpoint outside the push services", async () => {
    const { fetch, calls } = fakeFetch(() => 201);
    const send = createWebSender({ generate, fetch, vapid });
    const it1 = webItem("https://evil.example.com/collect");
    expect((await send(it1, buildMessage(it1))).outcome).toBe("failed");
    expect(calls).toHaveLength(0);
  });

  it("a subscription whose keys cannot be used fails for good", async () => {
    const { fetch } = fakeFetch(() => 201);
    const send = createWebSender({
      generate: () => {
        throw new Error("bad p256dh");
      },
      fetch,
      vapid,
    });
    const it1 = webItem();
    expect((await send(it1, buildMessage(it1))).outcome).toBe("failed");
  });
});

describe("expo sender", () => {
  it("one ticket per message: ok sent, DeviceNotRegistered gone, rate limit retry, other failed", async () => {
    const bodies: unknown[] = [];
    const fetch: FetchLike = async (url, init) => {
      expect(url).toBe(EXPO_PUSH_URL);
      expect(init.headers.Authorization).toBe("Bearer tok");
      bodies.push(JSON.parse(String(init.body)));
      return {
        status: 200,
        text: async () => "",
        json: async () => ({
          data: [
            { status: "ok", id: "1" },
            { status: "error", details: { error: "DeviceNotRegistered" } },
            { status: "error", details: { error: "MessageRateExceeded" } },
            { status: "error", details: { error: "InvalidCredentials" } },
          ],
        }),
      };
    };
    const send = createExpoSender({ fetch, accessToken: "tok" });
    const items = [expoItem(), expoItem(), expoItem(), expoItem()];
    const results = await send(items.map((item) => ({ item, message: buildMessage(item) })));
    expect(results.map((r) => r.outcome)).toEqual(["sent", "gone", "retry", "failed"]);
    const first = (bodies[0] as Record<string, unknown>[])[0];
    expect(first).toMatchObject({ to: "ExponentPushToken[abcdefghijkl]", sound: "default", priority: "high", channelId: "alerts" });
  });

  it("splits into batches of 100 and retries the whole batch on a 5xx", async () => {
    let posts = 0;
    const fetch: FetchLike = async (_url, init) => {
      posts += 1;
      const count = (JSON.parse(String(init.body)) as unknown[]).length;
      if (posts === 2) {
        return { status: 502, text: async () => "", json: async () => ({}) };
      }
      return {
        status: 200,
        text: async () => "",
        json: async () => ({ data: Array.from({ length: count }, () => ({ status: "ok" })) }),
      };
    };
    const send = createExpoSender({ fetch });
    const items = Array.from({ length: 150 }, () => expoItem());
    const results = await send(items.map((item) => ({ item, message: buildMessage(item) })));
    expect(posts).toBe(2);
    expect(results.filter((r) => r.outcome === "sent")).toHaveLength(100);
    expect(results.filter((r) => r.outcome === "retry")).toHaveLength(50);
  });

  it("a quiet summary has no sound", async () => {
    const sent: Record<string, unknown>[] = [];
    const fetch: FetchLike = async (_url, init) => {
      sent.push(...(JSON.parse(String(init.body)) as Record<string, unknown>[]));
      return { status: 200, text: async () => "", json: async () => ({ data: [{ status: "ok" }] }) };
    };
    const it1 = { ...expoItem(), kind: "summary" as const, summaryCount: 3 };
    await createExpoSender({ fetch })([{ item: it1, message: buildMessage(it1) }]);
    expect(sent[0]).toMatchObject({ sound: null, priority: "normal", channelId: "alerts-quiet" });
  });
});

describe("deliverBatch", () => {
  it("every item gets exactly one result, even when a sender throws", async () => {
    const items = [webItem(), webItem(), expoItem(), webItem()];
    const results = await deliverBatch(
      items,
      {
        web: async (item) => {
          if (item.id === items[1]?.id) throw new Error("boom");
          return { delivery_id: item.id, outcome: "sent" };
        },
        expo: async () => {
          throw new Error("expo down");
        },
      },
      2,
    );
    expect(results).toHaveLength(4);
    const byId = Object.fromEntries(results.map((r) => [r.delivery_id, r.outcome]));
    expect(byId[items[0]!.id]).toBe("sent");
    expect(byId[items[1]!.id]).toBe("retry");
    expect(byId[items[2]!.id]).toBe("retry");
    expect(byId[items[3]!.id]).toBe("sent");
  });
});

describe("parsePlan", () => {
  const good = {
    id: "11111111-1111-4111-8111-111111111111",
    kind: "alert",
    locale: "ckb",
    context: "another_place",
    target: { kind: "web", endpoint: "https://fcm.googleapis.com/x", p256dh: "p", auth: "a" },
    event: { id: "bml2026abcd", magnitude: "4.2", origin_time: "t", lat: 36, lon: 44, depth_km: null },
    previous_magnitude: null,
    summary_count: null,
    attempt: 2,
  };

  it("reads a run, numbers given as strings included", () => {
    const plan = parsePlan({ run_id: "22222222-2222-4222-8222-222222222222", mode: "testers", deliveries: [good] });
    expect(plan.runId).toBe("22222222-2222-4222-8222-222222222222");
    expect(plan.items[0]).toMatchObject({ locale: "ckb", context: "another_place", attempt: 2 });
    expect(plan.items[0]?.event?.magnitude).toBe(4.2);
  });

  it("an empty run", () => {
    expect(parsePlan({ run_id: null, mode: "off", deliveries: [] })).toEqual({
      runId: null,
      mode: "off",
      items: [],
      invalid: [],
    });
  });

  it("broken deliveries are set aside by id; unknown locale becomes English", () => {
    const plan = parsePlan({
      run_id: "22222222-2222-4222-8222-222222222222",
      mode: "public",
      deliveries: [
        { ...good, locale: "fr" },
        { ...good, id: "33333333-3333-4333-8333-333333333333", target: { kind: "sms" } },
        { ...good, id: "44444444-4444-4444-8444-444444444444", event: { ...good.event, id: "not-an-id" } },
        { ...good, id: "55555555-5555-4555-8555-555555555555", kind: "alert", event: null },
        "junk",
      ],
    });
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]?.locale).toBe("en");
    expect(plan.invalid).toEqual([
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555",
    ]);
  });

  it("refuses a non-object", () => {
    expect(() => parsePlan(null)).toThrow();
  });
});

describe("runSendAlerts", () => {
  const delivery = (i: number) => ({
    id: `00000000-0000-4000-9000-${String(i).padStart(12, "0")}`,
    kind: "test",
    locale: "en",
    target: { kind: "web", endpoint: "https://fcm.googleapis.com/x", p256dh: "p", auth: "a" },
    event: null,
    attempt: 1,
  });

  it("drains in rounds while full batches come back, then stops", async () => {
    const batches = [
      { run_id: "11111111-1111-4111-8111-111111111111", mode: "testers", deliveries: [delivery(1), delivery(2)] },
      { run_id: "22222222-2222-4222-8222-222222222222", mode: "testers", deliveries: [delivery(3)] },
      { run_id: "33333333-3333-4333-8333-333333333333", mode: "testers", deliveries: [delivery(4)] },
    ];
    const recorded: { run: string; count: number }[] = [];
    let i = 0;
    const summary = await runSendAlerts(
      {
        plan: async () => batches[i++] ?? { run_id: null, mode: "testers", deliveries: [] },
        record: async (run, results) => {
          recorded.push({ run, count: results.length });
        },
      },
      {
        web: async (item) => ({ delivery_id: item.id, outcome: "sent" }),
        expo: async () => [],
      },
      { limit: 2 },
    );
    expect(recorded).toEqual([
      { run: "11111111-1111-4111-8111-111111111111", count: 2 },
      { run: "22222222-2222-4222-8222-222222222222", count: 1 },
    ]);
    expect(summary).toMatchObject({ rounds: 2, claimed: 3, sent: 3 });
  });

  it("records a malformed delivery as failed so it is never claimed forever", async () => {
    let results: { delivery_id: string; outcome: string }[] = [];
    await runSendAlerts(
      {
        plan: async () => ({
          run_id: "11111111-1111-4111-8111-111111111111",
          mode: "testers",
          deliveries: [{ id: "99999999-9999-4999-8999-999999999999", kind: "alert", target: {} }],
        }),
        record: async (_run, r) => {
          results = r;
        },
      },
      { web: async () => ({ delivery_id: "x", outcome: "sent" }), expo: async () => [] },
    );
    expect(results).toEqual([
      { delivery_id: "99999999-9999-4999-8999-999999999999", outcome: "failed", error: "malformed delivery" },
    ]);
  });

  it("nothing to do: one plan call, no record", async () => {
    const record = jest.fn();
    const summary = await runSendAlerts(
      { plan: async () => ({ run_id: null, mode: "off", deliveries: [] }), record },
      { web: async () => ({ delivery_id: "x", outcome: "sent" }), expo: async () => [] },
    );
    expect(record).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ rounds: 1, mode: "off", claimed: 0 });
  });
});
