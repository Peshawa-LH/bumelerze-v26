import {
  processQueue,
  useFeltQueueStore,
  withdrawReport,
  type FeltTransport,
  type QueueItem,
} from "../queue";
import type { Tier1Report } from "../types";

/**
 * Review C-2 (2026-10-14): `processQueue` sent items from a snapshot taken
 * at the start of the pass, so a report withdrawn while an EARLIER item's
 * network call was in flight was still sent; the phone then showed it as
 * withdrawn while the server counted it. And a withdraw of the report that
 * was itself in flight simply failed.
 */
function tier1(id: string): Tier1Report {
  return {
    reportId: id,
    deviceId: "device-abcdef1234567890",
    eventId: "usgs:us1",
    eventRegistration: null,
    cartoonLevel: 5,
    location: { quality: "gps", lat: 36.19, lon: 44.01 },
    feltAt: 1_700_000_000_000,
    createdAt: 1_700_000_000_000,
    submittedAt: null,
  };
}

function queued(id: string): QueueItem {
  return {
    tier1: tier1(id),
    tier2: null,
    state: "queued",
    attempts: 0,
    lastAttemptAt: null,
    nextRetryAt: null,
    photoState: null,
  };
}

function stored(id: string): QueueItem {
  return useFeltQueueStore.getState().items.find((item) => item.tier1.reportId === id)!;
}

/** A transport whose first-part send for `heldId` waits until released. */
function heldTransport(heldId: string) {
  let release: (() => void) | null = null;
  const submitted: string[] = [];
  const transport: FeltTransport = {
    submitTier1: jest.fn(async (report: Tier1Report) => {
      submitted.push(report.reportId);
      if (report.reportId === heldId) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return { outcome: "submitted" as const, serverReportId: report.reportId };
    }),
    submitTier2: jest.fn(),
    withdrawReport: jest.fn(async () => "withdrawn" as const),
  };
  return {
    transport,
    submitted,
    release: () => {
      release?.();
    },
  };
}

describe("withdrawing while the queue is draining", () => {
  beforeEach(() => {
    useFeltQueueStore.setState({ items: [], hasHydrated: true });
  });

  it("a report withdrawn while an earlier one is in flight is never sent", async () => {
    useFeltQueueStore.setState({ items: [queued("A"), queued("B")] });
    const { transport, submitted, release } = heldTransport("A");

    const drain = processQueue(transport);
    await Promise.resolve(); // A is in flight; B is still queued, never attempted
    expect(stored("A").state).toBe("syncing");

    expect(await withdrawReport("B", transport, 5_000)).toBe("withdrawn");
    expect(transport.withdrawReport).not.toHaveBeenCalled(); // never left the phone

    release();
    await drain;

    expect(submitted).toEqual(["A"]);
    expect(stored("B")).toMatchObject({
      state: "queued",
      withdrawnAt: 5_000,
      withdrawnOnServer: false,
    });
    expect(stored("A").state).toBe("submitted");
  });

  it("withdrawing the report that is in flight waits for the send, then withdraws it on the server", async () => {
    useFeltQueueStore.setState({ items: [queued("A")] });
    const { transport, release } = heldTransport("A");

    const drain = processQueue(transport);
    await Promise.resolve();
    expect(stored("A").state).toBe("syncing");

    const withdrawal = withdrawReport("A", transport, 5_000);
    // Nothing happens while the send is in flight.
    await Promise.resolve();
    expect(transport.withdrawReport).not.toHaveBeenCalled();

    release();
    await drain;
    expect(await withdrawal).toBe("withdrawn");
    expect(transport.withdrawReport).toHaveBeenCalledWith("A", "device-abcdef1234567890");
    expect(stored("A")).toMatchObject({
      state: "submitted",
      withdrawnAt: 5_000,
      withdrawnOnServer: true,
    });
  });

  it("gives up (failed, nothing changed) when the send does not finish in time", async () => {
    useFeltQueueStore.setState({ items: [queued("A")] });
    const { transport, release } = heldTransport("A");

    const drain = processQueue(transport);
    await Promise.resolve();

    expect(await withdrawReport("A", transport, 5_000, 20)).toBe("failed");
    expect(stored("A").withdrawnAt).toBeUndefined();

    release();
    await drain;
    expect(stored("A").state).toBe("submitted");
  });

  it("a later pass still skips a withdrawn report that was queued", async () => {
    useFeltQueueStore.setState({ items: [queued("A")] });
    const transport: FeltTransport = {
      submitTier1: jest.fn(async (report: Tier1Report) => ({
        outcome: "submitted" as const,
        serverReportId: report.reportId,
      })),
      submitTier2: jest.fn(),
    };
    expect(await withdrawReport("A", transport, 5_000)).toBe("withdrawn");
    await processQueue(transport);
    expect(transport.submitTier1).not.toHaveBeenCalled();
    expect(stored("A").state).toBe("queued");
  });
});
