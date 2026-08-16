import type { FeltLocation, Tier2Answers } from "../types";

/**
 * Offline queue (spec-v1.md §4.6 states; wave brief scope item 6: "queue
 * (persist -> retry -> survives restart via mocked AsyncStorage)"). Same
 * fresh-require-per-test discipline as `features/onboarding/__tests__/
 * store.test.ts` — `jest.resetModules()` clears both the module cache AND
 * the AsyncStorage mock's in-memory backing store, so "survives restart" is
 * only provable by capturing the persisted JSON from session 1 and manually
 * re-seeding a FRESH (session 2) AsyncStorage mock with it, exactly like
 * that file's "gates on hasHydrated" test does for the prefs store.
 */

jest.mock("expo-crypto", () => ({
  randomUUID: () => {
    const g = globalThis as { __feltQueueTestUuidCounter?: number };
    g.__feltQueueTestUuidCounter = (g.__feltQueueTestUuidCounter ?? 0) + 1;
    return `test-report-uuid-${g.__feltQueueTestUuidCounter}`;
  },
}));

function loadQueue(): typeof import("../queue") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- must be required fresh after resetModules, inside each test
  return require("../queue");
}

function loadAsyncStorage() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see loadQueue
  return require("@react-native-async-storage/async-storage") as typeof import("@react-native-async-storage/async-storage").default;
}

const SAMPLE_LOCATION: FeltLocation = { quality: "gps", lat: 36.19, lon: 44.01 };

/**
 * `useQueueItemState` is a React hook (it calls the zustand store's own
 * hook form) — it cannot be invoked directly from test code outside a
 * render. Tests read queue state the same way any non-component caller
 * would: `store.getState()`, zustand's plain (non-hook) accessor.
 */
function itemState(
  store: ReturnType<typeof loadQueue>["useFeltQueueStore"],
  reportId: string,
) {
  return (
    store.getState().items.find((item) => item.tier1.reportId === reportId)?.state ?? null
  );
}

async function waitFor(predicate: () => boolean, attempts = 100): Promise<void> {
  for (let attempt = 0; attempt < attempts && !predicate(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (!predicate()) {
    throw new Error("waitFor: condition never became true");
  }
}

/** Async-predicate variant (used to poll `AsyncStorage.getItem`, itself
 * async) — `waitFor` above deliberately stays synchronous-predicate-only so
 * a plain `() => boolean` callers can't accidentally pass an async function
 * whose truthy Promise would make the loop a no-op. */
async function waitForAsync(
  predicate: () => Promise<boolean>,
  attempts = 100,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("waitForAsync: condition never became true");
}

beforeEach(() => {
  jest.resetModules();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("enqueueTier1Report + PendingTransport (no backend this wave)", () => {
  it("durably queues the report locally BEFORE any transport attempt resolves", async () => {
    const { enqueueTier1Report, useFeltQueueStore } = loadQueue();

    const report = await enqueueTier1Report({
      cartoonLevel: 4,
      location: SAMPLE_LOCATION,
      eventId: "evt-1",
    });

    // The report object itself (and the store entry) exist synchronously
    // once `enqueueTier1Report` resolves — no report is ever lost even if
    // the fire-and-forget transport attempt below never completes.
    const stored = useFeltQueueStore
      .getState()
      .items.find((item) => item.tier1.reportId === report.reportId);
    expect(stored).toBeTruthy();
    expect(stored?.tier1.cartoonLevel).toBe(4);
    expect(stored?.tier1.eventId).toBe("evt-1");
    expect(stored?.tier1.location).toEqual(SAMPLE_LOCATION);
    expect(stored?.tier1.submittedAt).toBeNull();
  });

  it("persists the queued item to AsyncStorage and settles into 'awaiting-backend' (no Supabase project yet)", async () => {
    const queue = loadQueue();

    const report = await queue.enqueueTier1Report({
      cartoonLevel: 7,
      location: SAMPLE_LOCATION,
      eventId: null,
    });

    await waitFor(
      () => itemState(queue.useFeltQueueStore, report.reportId) === "awaiting-backend",
    );

    const AsyncStorage = loadAsyncStorage();
    let raw: string | null = null;
    await waitForAsync(async () => {
      raw = await AsyncStorage.getItem("bumelerze.felt.queue");
      return raw !== null && raw.includes(report.reportId);
    });
    expect(raw).toContain(report.reportId);
    expect(raw).toContain('"cartoonLevel":7');
  });
});

describe("processQueue retry/backoff", () => {
  it("retries a retryable failure and eventually reaches 'submitted' once the transport succeeds", async () => {
    const queue = loadQueue();
    const { enqueueTier1Report, processQueue } = queue;

    let attempt = 0;
    const dateSpy = jest.spyOn(Date, "now");
    let currentTime = 1_700_000_000_000;
    dateSpy.mockImplementation(() => currentTime);

    const flakyTransport = {
      submitTier1: jest.fn(async () => {
        attempt += 1;
        if (attempt === 1) {
          return { outcome: "failed" as const, retryable: true };
        }
        return { outcome: "submitted" as const, serverReportId: "server-1" };
      }),
      submitTier2: jest.fn(async () => ({ outcome: "awaiting-backend" as const })),
    };

    const report = await enqueueTier1Report(
      { cartoonLevel: 5, location: SAMPLE_LOCATION, eventId: "evt-2" },
      flakyTransport,
    );

    // First attempt fails and schedules a backoff retry.
    await waitFor(() => itemState(queue.useFeltQueueStore, report.reportId) === "failed");
    expect(flakyTransport.submitTier1).toHaveBeenCalledTimes(1);

    // Immediately re-processing before the backoff window elapses must NOT
    // re-attempt yet (this is what makes it "backoff", not a hot loop).
    await processQueue(flakyTransport);
    expect(flakyTransport.submitTier1).toHaveBeenCalledTimes(1);

    // Advance past the backoff window and re-trigger (simulates the next
    // app-foreground sync) — now it succeeds.
    currentTime += 10 * 60_000;
    await processQueue(flakyTransport);
    await waitFor(
      () => itemState(queue.useFeltQueueStore, report.reportId) === "submitted",
    );
    expect(flakyTransport.submitTier1).toHaveBeenCalledTimes(2);
  });

  it("never drops the report on a non-retryable failure — it stays visible as 'failed'", async () => {
    const { enqueueTier1Report, useFeltQueueStore } = loadQueue();

    const deadEndTransport = {
      submitTier1: jest.fn(async () => ({
        outcome: "failed" as const,
        retryable: false,
      })),
      submitTier2: jest.fn(async () => ({ outcome: "awaiting-backend" as const })),
    };

    const report = await enqueueTier1Report(
      { cartoonLevel: 2, location: SAMPLE_LOCATION, eventId: null },
      deadEndTransport,
    );

    await waitFor(() => itemState(useFeltQueueStore, report.reportId) === "failed");

    // Still present in the store — "no report is ever lost" (acceptance
    // criterion) means a terminal failure is a visible state, not a delete.
    const stillThere = useFeltQueueStore
      .getState()
      .items.find((item) => item.tier1.reportId === report.reportId);
    expect(stillThere).toBeTruthy();
  });
});

describe("processQueue drain-timing regression: item enqueued WHILE a prior submission is in-flight", () => {
  it("drains a SECOND item enqueued mid-pass without any further explicit processQueue() call", async () => {
    // Reproduces the bug this test guards against: enqueueTier1Report's own
    // fire-and-forget `void processQueue(transport)` call raced against an
    // ALREADY-RUNNING pass (e.g. the cold-start drain in app/_layout.tsx,
    // or — as here — a first report's own still-in-flight network call).
    // Before the fix, the re-entrancy guard silently dropped that second
    // call; the second item was left in "queued" state with nothing left
    // to trigger it short of the next app-foreground transition, which on
    // web (a tab that never loses focus) may never come — this is the
    // "newest report never appeared" symptom from the live-testing brief.
    const { enqueueTier1Report, useFeltQueueStore } = loadQueue();

    let firstCallHeld = false;
    // Definite-assignment idiom (assigned synchronously inside the
    // executor, which itself runs synchronously as part of `new Promise`)
    // rather than `let ... | null = null`, which TypeScript's control-flow
    // narrowing can't see through the executor closure.
    let releaseFirstSubmit!: () => void;
    const firstSubmitGate = new Promise<void>((resolve) => {
      releaseFirstSubmit = resolve;
    });

    const submitTier1 = jest.fn(async (report: { reportId: string }) => {
      if (!firstCallHeld) {
        // Only the very FIRST invocation (report A) is held open — this
        // deliberately doesn't key off a specific report id, since the
        // mock is invoked synchronously as part of enqueueTier1Report's
        // own fire-and-forget call, before the test can capture report A's
        // id from the awaited return value.
        firstCallHeld = true;
        await firstSubmitGate;
      }
      return { outcome: "submitted" as const, serverReportId: report.reportId };
    });
    const racingTransport = {
      submitTier1,
      submitTier2: jest.fn(async () => ({ outcome: "awaiting-backend" as const })),
    };

    const reportA = await enqueueTier1Report(
      { cartoonLevel: 3, location: SAMPLE_LOCATION, eventId: null },
      racingTransport,
    );

    // At this point report A's own processQueue() pass has already reached
    // (and is suspended inside) `transport.submitTier1(reportA)` — see the
    // synchronous-until-first-await analysis in the comment above.
    expect(submitTier1).toHaveBeenCalledTimes(1);
    expect(itemState(useFeltQueueStore, reportA.reportId)).toBe("syncing");

    // Enqueued WHILE the pass above is still in flight — its own
    // processQueue() call must be remembered as a rerun, not dropped.
    const reportB = await enqueueTier1Report(
      { cartoonLevel: 7, location: SAMPLE_LOCATION, eventId: null },
      racingTransport,
    );
    expect(itemState(useFeltQueueStore, reportB.reportId)).toBe("queued");

    // Release report A's held network call — the in-flight pass should now
    // finish A, notice the rerun was requested, and loop again to pick up
    // B, all without the test calling processQueue() itself again.
    releaseFirstSubmit();

    await waitFor(
      () =>
        itemState(useFeltQueueStore, reportA.reportId) === "submitted" &&
        itemState(useFeltQueueStore, reportB.reportId) === "submitted",
    );

    expect(submitTier1).toHaveBeenCalledTimes(2);
  });
});

describe("survives an app restart", () => {
  it("re-hydrates the same queued item from AsyncStorage after a simulated restart", async () => {
    const session1 = loadQueue();
    const report = await session1.enqueueTier1Report({
      cartoonLevel: 9,
      location: { quality: "manual", lat: 35.56, lon: 45.43, townId: "halabja" },
      eventId: "evt-restart",
    });
    await session1.processQueue();

    const AsyncStorage1 = loadAsyncStorage();
    let persistedRaw: string | null = null;
    await waitForAsync(async () => {
      persistedRaw = await AsyncStorage1.getItem("bumelerze.felt.queue");
      return persistedRaw !== null && persistedRaw.includes(report.reportId);
    });
    expect(persistedRaw).toBeTruthy();

    // Simulate the app process being killed and relaunched: clear the whole
    // module registry (including the AsyncStorage mock's backing store),
    // then re-seed a FRESH AsyncStorage with exactly what was on "disk".
    jest.resetModules();
    const AsyncStorage2 = loadAsyncStorage();
    await AsyncStorage2.setItem(
      "bumelerze.felt.queue",
      persistedRaw as unknown as string,
    );

    const session2 = loadQueue();
    await waitFor(() => session2.useFeltQueueStore.getState().hasHydrated);

    const restored = session2.useFeltQueueStore
      .getState()
      .items.find((item) => item.tier1.reportId === report.reportId);

    expect(restored).toBeTruthy();
    expect(restored?.tier1.cartoonLevel).toBe(9);
    expect(restored?.tier1.eventId).toBe("evt-restart");
    expect(restored?.tier1.location).toEqual({
      quality: "manual",
      lat: 35.56,
      lon: 45.43,
      townId: "halabja",
    });
    // The record survived intact even though it was never actually sent
    // anywhere (PendingTransport) — this IS the "no report is ever lost"
    // acceptance criterion under test.
    expect(restored?.state).toBe("awaiting-backend");
  });
});

describe("enqueueTier2Report (D18 §3.2 supersede-in-place)", () => {
  it("attaches tier 2 to the SAME queue item rather than creating a second one", async () => {
    const { enqueueTier1Report, enqueueTier2Report, useFeltQueueStore } = loadQueue();

    const tier1 = await enqueueTier1Report({
      cartoonLevel: 6,
      location: SAMPLE_LOCATION,
      eventId: "evt-3",
    });

    const answers: Tier2Answers = {
      situation: "inside",
      felt: "yes",
      othersFelt: "most",
      motion: "strong",
      reaction: "somewhat_frightened",
      stand: "no",
      shelf: "few_fell",
      picture: "yes",
      furniture: "no",
      buildingDamageLevel: 1,
      damageTypology: "highrise",
      roadDamageLevel: 0,
      comment: "Books fell off the shelf.",
    };

    await enqueueTier2Report({
      feltReportId: tier1.reportId,
      answers,
      photoUri: "file:///tmp/damage.jpg",
    });

    const items = useFeltQueueStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]?.tier1.reportId).toBe(tier1.reportId);
    expect(items[0]?.tier2?.answers).toEqual(answers);
    expect(items[0]?.tier2?.photoUri).toBe("file:///tmp/damage.jpg");
  });

  it("throws rather than silently dropping an answer set for an unknown report id", async () => {
    const { enqueueTier2Report } = loadQueue();

    await expect(
      enqueueTier2Report({
        feltReportId: "does-not-exist",
        answers: {
          situation: null,
          felt: null,
          othersFelt: null,
          motion: null,
          reaction: null,
          stand: null,
          shelf: null,
          picture: null,
          furniture: null,
          buildingDamageLevel: null,
          damageTypology: null,
          roadDamageLevel: null,
          comment: null,
        },
      }),
    ).rejects.toThrow(/no queued tier-1 report/);
  });
});
