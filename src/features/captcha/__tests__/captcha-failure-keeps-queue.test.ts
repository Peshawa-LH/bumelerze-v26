import type { FeltLocation } from "@/features/felt/types";

/**
 * The failure rule of A1.4 end to end: CAPTCHA protection is ON in Supabase
 * and Turnstile cannot produce a token (offline, blocked, timed out). The
 * anonymous sign-in is refused, so the write is refused too (anon lost
 * INSERT: 0073 felt, 0078 feedback) — and the report / message must stay
 * queued, never lost, and go out on a later attempt once a token comes.
 * Real lib/supabase, real queues and transports; only supabase-js is faked
 * (no network anywhere).
 */

jest.mock("expo-crypto", () => ({
  randomUUID: () => {
    const g = globalThis as { __captchaQueueUuid?: number };
    g.__captchaQueueUuid = (g.__captchaQueueUuid ?? 0) + 1;
    return `00000000-0000-4000-8000-${String(g.__captchaQueueUuid).padStart(12, "0")}`;
  },
}));

type Call = { options?: { captchaToken?: string } } | undefined;

const mockServer = {
  session: null as { user: { id: string } } | null,
  signInCalls: [] as Call[],
  inserts: [] as { table: string; row: unknown }[],
};

jest.mock("@supabase/supabase-js", () => {
  const client = {
    auth: {
      getSession: jest.fn(async () => ({
        data: { session: mockServer.session },
        error: null,
      })),
      // CAPTCHA protection ON: no token, no session.
      signInAnonymously: jest.fn(async (...args: Call[]) => {
        mockServer.signInCalls.push(args[0]);
        if (!args[0]?.options?.captchaToken) {
          return {
            data: { user: null, session: null },
            error: {
              code: "captcha_failed",
              status: 400,
              message:
                "captcha protection: request disallowed (no captcha response (captcha_token) found in request)",
            },
          };
        }
        mockServer.session = { user: { id: "anon-uid-7" } };
        return {
          data: { user: mockServer.session.user, session: mockServer.session },
          error: null,
        };
      }),
      startAutoRefresh: jest.fn(),
      stopAutoRefresh: jest.fn(),
    },
    from: jest.fn((table: string) => ({
      insert: jest.fn(async (row: unknown) => {
        if (!mockServer.session) {
          return {
            error: {
              code: "42501",
              message: `new row violates row-level security policy for table "${table}"`,
            },
          };
        }
        mockServer.inserts.push({ table, row });
        return { error: null };
      }),
    })),
    rpc: jest.fn(async () => ({ data: null, error: { code: "42501", message: "no" } })),
  };
  return { createClient: jest.fn(() => client) };
});

const ORIGINAL_ENV = { ...process.env };
const LOCATION: FeltLocation = { quality: "gps", lat: 36.19, lon: 44.01 };

/* eslint-disable @typescript-eslint/no-require-imports -- modules load after the env is set */
const testKeys = require("../test-keys") as typeof import("../test-keys");
process.env.EXPO_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = "sb_publishable_test";
process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY =
  testKeys.TURNSTILE_TEST_SITE_KEYS.passInvisible;
const broker = require("../token-broker") as typeof import("../token-broker");
const feltQueue =
  require("@/features/felt/queue") as typeof import("@/features/felt/queue");
const feltTransport =
  require("@/features/felt/supabase-transport") as typeof import("@/features/felt/supabase-transport");
const feedbackQueue =
  require("@/features/feedback/queue") as typeof import("@/features/feedback/queue");
const feedbackTransport =
  require("@/features/feedback/supabase-transport") as typeof import("@/features/feedback/supabase-transport");
/* eslint-enable @typescript-eslint/no-require-imports */

/** A stand-in for the widget: every request fails (Turnstile blocked) or
 * gets the next token. */
let turnstileWorks = false;
let tokenCount = 0;
const stopHost = broker.useCaptchaStore.subscribe((state) => {
  const request = state.active;
  if (!request) {
    return;
  }
  if (turnstileWorks) {
    broker.resolveCaptchaRequest(request.id, `tok-${++tokenCount}`);
  } else {
    broker.failCaptchaRequest(request.id);
  }
});

afterAll(() => {
  stopHost();
  process.env = { ...ORIGINAL_ENV };
});

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("CAPTCHA on, Turnstile failing", () => {
  it("a felt report stays queued (retryable), then goes out with a token on a later attempt", async () => {
    const report = await feltQueue.enqueueTier1Report(
      { cartoonLevel: 5, location: LOCATION, eventId: null },
      feltTransport.SupabaseTransport,
    );
    await settle();

    const item = () =>
      feltQueue.useFeltQueueStore
        .getState()
        .items.find((candidate) => candidate.tier1.reportId === report.reportId);
    // Sign-in went out WITHOUT a token (no options at all) and was refused;
    // the insert was refused; the report is still on the phone, due again.
    expect(mockServer.signInCalls[0]).toBeUndefined();
    expect(mockServer.inserts).toEqual([]);
    expect(item()?.state).toBe("failed");
    expect(item()?.nextRetryAt).toEqual(expect.any(Number));
    expect(item()?.tier1.cartoonLevel).toBe(5);

    // Later (next return to the app): Turnstile works again.
    turnstileWorks = true;
    feltQueue.useFeltQueueStore
      .getState()
      ._patchItem(report.reportId, { nextRetryAt: 0 });
    await feltQueue.processQueue(feltTransport.SupabaseTransport);
    await settle();

    expect(mockServer.signInCalls.at(-1)).toEqual({ options: { captchaToken: "tok-1" } });
    expect(item()?.state).toBe("submitted");
    expect(mockServer.inserts).toEqual([
      expect.objectContaining({
        table: "felt_reports",
        row: expect.objectContaining({
          report_id: report.reportId,
          user_id: "anon-uid-7",
        }),
      }),
    ]);
  });

  it("feedback written while the sign-in is refused stays queued and is sent once a session exists", async () => {
    // Fresh start: no session again, Turnstile blocked again.
    mockServer.session = null;
    turnstileWorks = false;
    // lib/supabase remembers a successful sign-in; a signed-out device forgets it.
    (require("@/lib/supabase") as typeof import("@/lib/supabase")).resetAnonymousSignIn(); // eslint-disable-line @typescript-eslint/no-require-imports

    const submission = await feedbackQueue.enqueueFeedback(
      { message: "The map froze." },
      feedbackTransport.SupabaseFeedbackTransport,
    );
    await settle();
    const item = () =>
      feedbackQueue.useFeedbackQueueStore
        .getState()
        .items.find(
          (candidate) => candidate.submission.feedbackId === submission.feedbackId,
        );
    expect(item()?.state).toBe("failed");
    expect(item()?.nextRetryAt).toEqual(expect.any(Number));

    turnstileWorks = true;
    feedbackQueue.useFeedbackQueueStore.getState()._patchItem(submission.feedbackId, {
      nextRetryAt: 0,
    });
    await feedbackQueue.processFeedbackQueue(feedbackTransport.SupabaseFeedbackTransport);
    await settle();
    expect(item()?.state).toBe("submitted");
    expect(mockServer.inserts.at(-1)).toEqual({
      table: "feedback",
      row: expect.objectContaining({ message: "The map froze.", user_id: "anon-uid-7" }),
    });
  });
});
