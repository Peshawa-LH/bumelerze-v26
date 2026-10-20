/**
 * Expo push receipts (migration 0068): the ticket id of an accepted phone
 * push is passed to the database; due receipts are asked for after the
 * sending; DeviceNotRegistered switches the phone off (gone), other receipt
 * errors fail the delivery, a missing receipt or an Expo outage waits; and
 * before 0068 is applied the receipt step reports "unavailable" without
 * touching the sending. Web pushes never carry a ticket.
 */
import { buildMessage, type AlertItem } from "../message";
import {
  createReceiptChecker,
  EXPO_RECEIPTS_URL,
  parseDueReceipts,
  summarizeReceipts,
  type DueReceipt,
} from "../receipts";
import { runSendAlerts } from "../run";
import { createExpoSender, createWebSender, type FetchLike } from "../senders";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const due = (n: number, ticket = `ticket-${n}`): DueReceipt => ({ delivery_id: ID(n), ticket });

function jsonFetch(answer: (url: string, body: unknown) => { status: number; json?: unknown } | Error) {
  const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, headers: init.headers, body });
    const result = answer(url, body);
    if (result instanceof Error) throw result;
    return { status: result.status, text: async () => "", json: async () => result.json ?? {} };
  };
  return { fetch, calls };
}

describe("parseDueReceipts", () => {
  it("keeps well-formed rows only", () => {
    expect(
      parseDueReceipts([
        { delivery_id: ID(1), ticket: "abc-123" },
        { delivery_id: "nope", ticket: "abc" },
        { delivery_id: ID(2), ticket: "has spaces" },
        { delivery_id: ID(3) },
        null,
      ]),
    ).toEqual([{ delivery_id: ID(1), ticket: "abc-123" }]);
    expect(parseDueReceipts(null)).toEqual([]);
    expect(parseDueReceipts({})).toEqual([]);
  });
});

describe("the receipt checker", () => {
  it("asks Expo for the tickets and maps each receipt", async () => {
    const { fetch, calls } = jsonFetch(() => ({
      status: 200,
      json: {
        data: {
          "ticket-1": { status: "ok" },
          "ticket-2": { status: "error", message: "not registered", details: { error: "DeviceNotRegistered" } },
          "ticket-3": { status: "error", message: "too big", details: { error: "MessageTooBig" } },
          "ticket-4": { status: "error", details: { error: "InvalidCredentials" } },
        },
      },
    }));
    const check = createReceiptChecker({ fetch, accessToken: "tok" });
    const results = await check([due(1), due(2), due(3), due(4), due(5)]);
    expect(calls[0]?.url).toBe(EXPO_RECEIPTS_URL);
    expect(calls[0]?.headers.Authorization).toBe("Bearer tok");
    expect(calls[0]?.body).toEqual({ ids: ["ticket-1", "ticket-2", "ticket-3", "ticket-4", "ticket-5"] });
    expect(results.map((r) => r.outcome)).toEqual(["ok", "gone", "failed", "failed", "pending"]);
    expect(results[1]?.error).toContain("DeviceNotRegistered");
    expect(results[3]?.error).toContain("InvalidCredentials");
    expect(summarizeReceipts(results)).toEqual({ checked: 5, ok: 1, gone: 1, failed: 2, pending: 1 });
  });

  it("an Expo outage or no connection: everything waits for the next try", async () => {
    const down = createReceiptChecker({ fetch: jsonFetch(() => ({ status: 503 })).fetch });
    expect((await down([due(1), due(2)])).map((r) => r.outcome)).toEqual(["pending", "pending"]);
    const offline = createReceiptChecker({ fetch: jsonFetch(() => new Error("offline")).fetch });
    expect((await offline([due(1)])).map((r) => r.outcome)).toEqual(["pending"]);
  });

  it("asks at most 1000 tickets per request", async () => {
    const { fetch, calls } = jsonFetch((_url, body) => ({
      status: 200,
      json: { data: Object.fromEntries((body as { ids: string[] }).ids.map((id) => [id, { status: "ok" }])) },
    }));
    const results = await createReceiptChecker({ fetch })(Array.from({ length: 1500 }, (_, i) => due(i + 1)));
    expect(calls.map((c) => (c.body as { ids: string[] }).ids.length)).toEqual([1000, 500]);
    expect(results.every((r) => r.outcome === "ok")).toBe(true);
  });
});

const EVENT = { id: "bml2026abcd", magnitude: 4.2, originTime: "x", lat: 36.2, lon: 44, depthKm: null };
function expoItem(n: number): AlertItem {
  return {
    id: ID(n),
    kind: "alert",
    locale: "en",
    context: "near_me",
    target: { kind: "expo", token: "ExponentPushToken[abcdefghijkl]" },
    event: EVENT,
    previousMagnitude: null,
    summaryCount: null,
    attempt: 1,
  };
}

describe("tickets", () => {
  it("an accepted phone push hands its ticket id to the database; a malformed id is left out", async () => {
    const { fetch } = jsonFetch(() => ({
      status: 200,
      json: { data: [{ status: "ok", id: "0e3c2c0a-1111-4222-8333-444455556666" }, { status: "ok", id: "bad id" }, { status: "ok" }] },
    }));
    const items = [expoItem(1), expoItem(2), expoItem(3)];
    const results = await createExpoSender({ fetch })(items.map((item) => ({ item, message: buildMessage(item) })));
    expect(results).toEqual([
      { delivery_id: ID(1), outcome: "sent", ticket: "0e3c2c0a-1111-4222-8333-444455556666" },
      { delivery_id: ID(2), outcome: "sent" },
      { delivery_id: ID(3), outcome: "sent" },
    ]);
  });

  it("a web push never carries a ticket (the web path is unchanged)", async () => {
    const item: AlertItem = {
      ...expoItem(4),
      target: { kind: "web", endpoint: "https://fcm.googleapis.com/fcm/send/x", p256dh: "p", auth: "a" },
    };
    const send = createWebSender({
      generate: (sub, payload) => ({ method: "POST", endpoint: sub.endpoint, headers: {}, body: payload }),
      fetch: async () => ({ status: 201, text: async () => "", json: async () => ({}) }),
      vapid: { subject: "mailto:x", publicKey: "p", privateKey: "q" },
    });
    expect(await send(item, buildMessage(item))).toEqual({ delivery_id: ID(4), outcome: "sent" });
  });
});

describe("the receipt step of a run", () => {
  const plan = {
    run_id: "11111111-1111-4111-8111-111111111111",
    mode: "testers",
    deliveries: [
      { id: ID(9), kind: "test", locale: "en", target: { kind: "expo", token: "ExponentPushToken[abcdefghijkl]" }, event: null, attempt: 1 },
    ],
  };
  const senders = {
    web: async () => ({ delivery_id: "x", outcome: "sent" as const }),
    expo: async () => [{ delivery_id: ID(9), outcome: "sent" as const, ticket: "t-9" }],
  };

  it("after the sending: due receipts are checked and stored, and the run says how many", async () => {
    const order: string[] = [];
    const recordedResults: unknown[] = [];
    let recordedReceipts: unknown[] = [];
    let first = true;
    const summary = await runSendAlerts(
      {
        plan: async () => {
          order.push("plan");
          const answer = first ? plan : { run_id: null, mode: "testers", deliveries: [] };
          first = false;
          return answer;
        },
        record: async (_run, results) => {
          order.push("record");
          recordedResults.push(...results);
        },
        receiptsDue: async (limit) => {
          order.push(`due ${limit}`);
          return [{ delivery_id: ID(1), ticket: "t-1" }, { delivery_id: ID(2), ticket: "t-2" }];
        },
        recordReceipts: async (results) => {
          order.push("recordReceipts");
          recordedReceipts = results;
        },
      },
      senders,
      {
        checkReceipts: async (d) =>
          d.map((r, i) => ({ delivery_id: r.delivery_id, outcome: i === 0 ? ("ok" as const) : ("gone" as const) })),
      },
    );
    expect(order).toEqual(["plan", "record", "due 300", "recordReceipts"]);
    expect(recordedResults).toEqual([{ delivery_id: ID(9), outcome: "sent", ticket: "t-9" }]);
    expect(recordedReceipts).toEqual([
      { delivery_id: ID(1), outcome: "ok" },
      { delivery_id: ID(2), outcome: "gone" },
    ]);
    expect(summary).toMatchObject({ sent: 1, receipts: { checked: 2, ok: 1, gone: 1, failed: 0, pending: 0 } });
  });

  it("before migration 0068: the receipts are 'unavailable' and the sending stands", async () => {
    const record = jest.fn(async () => undefined);
    const checkReceipts = jest.fn(async () => []);
    const summary = await runSendAlerts(
      {
        plan: async () => plan,
        record,
        receiptsDue: async () => {
          throw new Error("alert_receipts_due: Could not find the function public.alert_receipts_due(p_limit)");
        },
        recordReceipts: async () => undefined,
      },
      senders,
      { checkReceipts, limit: 5 },
    );
    expect(record).toHaveBeenCalledTimes(1);
    expect(checkReceipts).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ sent: 1, receipts: "unavailable" });
  });

  it("nothing due: no request to Expo", async () => {
    const checkReceipts = jest.fn(async () => []);
    const summary = await runSendAlerts(
      {
        plan: async () => ({ run_id: null, mode: "testers", deliveries: [] }),
        record: async () => undefined,
        receiptsDue: async () => [],
        recordReceipts: async () => undefined,
      },
      senders,
      { checkReceipts },
    );
    expect(checkReceipts).not.toHaveBeenCalled();
    expect(summary.receipts).toEqual({ checked: 0, ok: 0, gone: 0, failed: 0, pending: 0 });
  });

  it("out of time after sending: the receipts wait for the next call", async () => {
    let t = 0;
    const receiptsDue = jest.fn(async () => []);
    const summary = await runSendAlerts(
      {
        plan: async () => {
          t = 50_000;
          return plan;
        },
        record: async () => undefined,
        receiptsDue,
        recordReceipts: async () => undefined,
      },
      senders,
      { checkReceipts: async () => [], now: () => t, budgetMs: 40_000, limit: 5 },
    );
    expect(receiptsDue).not.toHaveBeenCalled();
    expect(summary.receipts).toBeUndefined();
  });
});
