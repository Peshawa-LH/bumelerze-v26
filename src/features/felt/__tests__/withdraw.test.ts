import {
  WITHDRAW_UNDO_WINDOW_MS,
  processQueue,
  reconcileSubmittedReports,
  restoreWithdrawnReport,
  useFeltQueueStore,
  withdrawReport,
  type FeltTransport,
  type QueueItem,
} from "../queue";
import type { Tier1Report } from "../types";

/**
 * "Withdraw" in My reports (review note 10.1, migration 0064): a sent report
 * is withdrawn on the server first; one that never left the phone is simply
 * never sent. Undo goes back the same way.
 */

const TIER1: Tier1Report = {
  reportId: "r1",
  deviceId: "device-abcdef1234567890",
  eventId: "usgs:us1",
  eventRegistration: null,
  cartoonLevel: 5,
  location: { quality: "gps", lat: 36.19, lon: 44.01 },
  feltAt: 1_700_000_000_000,
  createdAt: 1_700_000_000_000,
  submittedAt: null,
};

function item(
  overrides: Partial<QueueItem> = {},
  tier1: Partial<Tier1Report> = {},
): QueueItem {
  return {
    tier1: { ...TIER1, ...tier1 },
    tier2: null,
    state: "submitted",
    attempts: 0,
    lastAttemptAt: 1_700_000_000_500,
    nextRetryAt: null,
    photoState: null,
    ...overrides,
  };
}

function transport(overrides: Partial<FeltTransport> = {}): jest.Mocked<FeltTransport> {
  return {
    submitTier1: jest.fn(async () => ({
      outcome: "submitted" as const,
      serverReportId: "r1",
    })),
    submitTier2: jest.fn(async () => ({
      outcome: "submitted" as const,
      serverReportId: "d1",
    })),
    withdrawReport: jest.fn(async () => "withdrawn" as const),
    restoreReport: jest.fn(async () => "restored" as const),
    existingReportIds: jest.fn(async () => new Set<string>()),
    ...overrides,
  } as jest.Mocked<FeltTransport>;
}

function stored(id = "r1"): QueueItem | undefined {
  return useFeltQueueStore.getState().items.find((entry) => entry.tier1.reportId === id);
}

describe("withdrawing a felt report from the phone", () => {
  beforeEach(() => {
    useFeltQueueStore.setState({ items: [], hasHydrated: true });
  });

  it("withdraws a sent report on the server with its device id, then hides it", async () => {
    useFeltQueueStore.setState({ items: [item()] });
    const t = transport();
    expect(await withdrawReport("r1", t, 5_000)).toBe("withdrawn");
    expect(t.withdrawReport).toHaveBeenCalledWith("r1", "device-abcdef1234567890");
    expect(stored()).toMatchObject({ withdrawnAt: 5_000, withdrawnOnServer: true });
  });

  it("changes nothing when the server cannot be asked (the person can try again)", async () => {
    useFeltQueueStore.setState({ items: [item()] });
    const t = transport({ withdrawReport: jest.fn(async () => "failed" as const) });
    expect(await withdrawReport("r1", t)).toBe("failed");
    expect(stored()?.withdrawnAt).toBeUndefined();
  });

  it("treats a report the server does not have as withdrawn (nothing to take out)", async () => {
    useFeltQueueStore.setState({ items: [item()] });
    const t = transport({ withdrawReport: jest.fn(async () => "not_found" as const) });
    expect(await withdrawReport("r1", t)).toBe("withdrawn");
    expect(stored()).toMatchObject({ withdrawnOnServer: false });
  });

  it("never sends a report that had not left the phone, and asks no server", async () => {
    useFeltQueueStore.setState({
      items: [item({ state: "queued", lastAttemptAt: null })],
    });
    const t = transport();
    expect(await withdrawReport("r1", t)).toBe("withdrawn");
    expect(t.withdrawReport).not.toHaveBeenCalled();
    await processQueue(t);
    expect(t.submitTier1).not.toHaveBeenCalled();
    expect(stored()?.state).toBe("queued");
  });

  it("refuses while a send is in flight", async () => {
    useFeltQueueStore.setState({ items: [item({ state: "syncing" })] });
    const t = transport();
    expect(await withdrawReport("r1", t)).toBe("failed");
    expect(t.withdrawReport).not.toHaveBeenCalled();
  });

  it("Undo asks the server back and shows the report again", async () => {
    useFeltQueueStore.setState({
      items: [item({ withdrawnAt: 1, withdrawnOnServer: true })],
    });
    const t = transport();
    await restoreWithdrawnReport("r1", t);
    expect(t.restoreReport).toHaveBeenCalledWith("r1", "device-abcdef1234567890");
    expect(stored()).toMatchObject({ withdrawnAt: null, withdrawnOnServer: false });
  });

  it("Undo throws when the server says it is too late, and the report stays withdrawn", async () => {
    useFeltQueueStore.setState({
      items: [item({ withdrawnAt: 1, withdrawnOnServer: true })],
    });
    const t = transport({ restoreReport: jest.fn(async () => "expired" as const) });
    await expect(restoreWithdrawnReport("r1", t)).rejects.toThrow(/expired/);
    expect(stored()?.withdrawnAt).toBe(1);
  });

  it("Undo of a never-sent report sends it as before", async () => {
    useFeltQueueStore.setState({
      items: [
        item({
          state: "queued",
          lastAttemptAt: null,
          withdrawnAt: 1,
          withdrawnOnServer: false,
        }),
      ],
    });
    const t = transport();
    await restoreWithdrawnReport("r1", t);
    expect(t.restoreReport).not.toHaveBeenCalled();
    await processQueue(t);
    expect(t.submitTier1).toHaveBeenCalledTimes(1);
  });

  it("keeps a just-withdrawn report through a reconcile (Undo still possible), forgets an old one", async () => {
    const now = Date.now();
    useFeltQueueStore.setState({
      items: [
        item(
          { withdrawnAt: now - 1_000, withdrawnOnServer: true },
          { reportId: "fresh" },
        ),
        item(
          { withdrawnAt: now - WITHDRAW_UNDO_WINDOW_MS - 1, withdrawnOnServer: true },
          { reportId: "old" },
        ),
      ],
    });
    const t = transport();
    await reconcileSubmittedReports(t);
    expect(t.existingReportIds).toHaveBeenCalledWith(["old"], "device-abcdef1234567890");
    expect(
      useFeltQueueStore.getState().items.map((entry) => entry.tier1.reportId),
    ).toEqual(["fresh"]);
  });
});
