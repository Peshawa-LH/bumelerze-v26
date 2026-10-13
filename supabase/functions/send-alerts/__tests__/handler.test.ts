/**
 * send-alerts request handling (handler.ts, wired by index.ts): the health
 * answer shows only the mode and "ok" / "mismatch" / "missing" for the keys,
 * with no side effect; a send is refused before anything is planned or
 * claimed unless the keys are "ok"; the body takes no targeting input.
 */
import { handleRequest, parseRequest, type HandlerDeps } from "../handler";
import type { RunSummary } from "../run";
import type { KeyCheck } from "../vapid-check";

const SUMMARY: RunSummary = { rounds: 1, mode: "testers", claimed: 1, sent: 1, gone: 0, retry: 0, failed: 0 };
const SECRETS: Record<string, string> = {
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  VAPID_PUBLIC_KEY: "PUBLIC-SECRET-VALUE",
  VAPID_PRIVATE_KEY: "PRIVATE-SECRET-VALUE",
  VAPID_SUBJECT: "mailto:dev@bumelerze.com",
};

function deps(keys: KeyCheck, env: Record<string, string> = SECRETS) {
  const run = jest.fn(async () => SUMMARY);
  const readMode = jest.fn(async () => "testers");
  const d: HandlerDeps = {
    env: (name) => env[name],
    requestId: () => "req-1",
    checkKeys: () => keys,
    readMode,
    run,
    log: jest.fn(),
  };
  return { d, run, readMode };
}

describe("health", () => {
  it.each(["ok", "mismatch", "missing"] as const)("GET answers the mode and keys=%s, and sends nothing", async (keys) => {
    const { d, run } = deps(keys);
    const result = await handleRequest("GET", "", d);
    expect(result).toEqual({ status: 200, body: { data: { requestId: "req-1", mode: "testers", keys } } });
    expect(run).not.toHaveBeenCalled();
  });

  it("POST {health:true} is the same", async () => {
    const { d, run } = deps("ok");
    const result = await handleRequest("POST", '{"health":true}', d);
    expect(result.body).toEqual({ data: { requestId: "req-1", mode: "testers", keys: "ok" } });
    expect(run).not.toHaveBeenCalled();
  });

  it("never shows a key value", async () => {
    const { d } = deps("mismatch");
    const text = JSON.stringify(await handleRequest("GET", "", d));
    for (const value of Object.values(SECRETS)) {
      expect(text).not.toContain(value);
    }
  });

  it("without the database the mode is unknown", async () => {
    const { d, readMode } = deps("missing", {});
    const result = await handleRequest("GET", "", d);
    expect(result.body).toEqual({ data: { requestId: "req-1", mode: "unknown", keys: "missing" } });
    expect(readMode).not.toHaveBeenCalled();
  });
});

describe("sending", () => {
  it("keys ok: sends, with the secrets passed to the web push signer", async () => {
    const { d, run } = deps("ok");
    const result = await handleRequest("POST", "{}", d);
    expect(result).toEqual({ status: 200, body: { data: { requestId: "req-1", keys: "ok", ...SUMMARY } } });
    expect(run).toHaveBeenCalledWith(200, {
      subject: "mailto:dev@bumelerze.com",
      publicKey: "PUBLIC-SECRET-VALUE",
      privateKey: "PRIVATE-SECRET-VALUE",
    });
  });

  it("keys mismatch: refuses before planning anything (the queue waits)", async () => {
    const { d, run } = deps("mismatch");
    const result = await handleRequest("POST", "{}", d);
    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ error: { code: "vapid_keys", requestId: "req-1" } });
    expect(run).not.toHaveBeenCalled();
  });

  it("keys missing or no subject: misconfigured, nothing planned", async () => {
    const missing = deps("missing");
    expect((await handleRequest("POST", "", missing.d)).body).toMatchObject({ error: { code: "misconfigured" } });
    expect(missing.run).not.toHaveBeenCalled();
    const noSubject = deps("ok", { ...SECRETS, VAPID_SUBJECT: "" });
    expect((await handleRequest("POST", "{}", noSubject.d)).status).toBe(500);
    expect(noSubject.run).not.toHaveBeenCalled();
  });

  it("a failed run is reported, not thrown", async () => {
    const { d, run } = deps("ok");
    run.mockRejectedValueOnce(new Error("alert_plan_run: boom"));
    expect(await handleRequest("POST", "{}", d)).toEqual({
      status: 500,
      body: { error: { code: "send_failed", message: "alert_plan_run: boom", requestId: "req-1" } },
    });
  });
});

describe("what a call may ask", () => {
  it.each([
    ["POST", "", { ok: true, health: false, limit: 200 }],
    ["POST", "{}", { ok: true, health: false, limit: 200 }],
    ["POST", '{"limit": 50}', { ok: true, health: false, limit: 50 }],
    ["GET", "", { ok: true, health: true, limit: 200 }],
  ])("%s %s", (method, body, expected) => {
    expect(parseRequest(method, body)).toEqual(expected);
  });

  it.each([
    ["PUT", "{}", "method_not_allowed"],
    ["POST", "{", "invalid_json"],
    ["POST", "[]", "invalid_request"],
    ["POST", '{"limit": 0}', "invalid_request"],
    ["POST", '{"limit": 501}', "invalid_request"],
    ["POST", '{"limit": 1.5}', "invalid_request"],
    ["POST", '{"health": false}', "invalid_request"],
    // No targeting input: an event, a person or a device is refused.
    ["POST", '{"event_id": "x"}', "invalid_request"],
    ["POST", '{"user_id": "x"}', "invalid_request"],
  ])("%s %s -> %s", (method, body, code) => {
    expect(parseRequest(method, body)).toMatchObject({ ok: false, code });
  });

  it("a refused request answers 405 / 400 and runs nothing", async () => {
    const { d, run } = deps("ok");
    expect((await handleRequest("DELETE", "", d)).status).toBe(405);
    expect((await handleRequest("POST", '{"event_id":"x"}', d)).status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });
});
