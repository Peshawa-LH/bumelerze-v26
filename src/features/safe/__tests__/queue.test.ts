import type { EventRegistration } from "@/features/felt";

import {
  __resetCheckInQueueForTests,
  enqueueCheckIn,
  markPromptHandled,
  processCheckInQueue,
  undoCheckIn,
  useCheckInStore,
} from "../queue";
import type { CheckInInput, CheckInResult, CheckInTransport } from "../transport";

let mockUuid = 0;
jest.mock("expo-crypto", () => ({
  randomUUID: () => `client-${++mockUuid}`,
}));

const EVENT: EventRegistration = {
  provider: "usgs",
  providerId: "us7000abcd",
  originTime: Date.UTC(2026, 9, 8, 11, 21),
  lat: 35.3,
  lon: 46.1,
  depthKm: 10,
  magnitude: 5.1,
  magType: "mww",
  placeName: "Halabja",
};
const KEY = "usgs:us7000abcd";

function fakeTransport(overrides: Partial<CheckInTransport> = {}) {
  const calls: { checkIn: CheckInInput[]; retract: string[]; resolve: number } = {
    checkIn: [],
    retract: [],
    resolve: 0,
  };
  const transport: CheckInTransport = {
    resolveEvent: async () => {
      calls.resolve += 1;
      return "server-event-1";
    },
    checkIn: async (input) => {
      calls.checkIn.push(input);
      return { outcome: "sent" };
    },
    retract: async (id) => {
      calls.retract.push(id);
      return true;
    },
    ...overrides,
  };
  return { transport, calls };
}

const items = () => useCheckInStore.getState().items;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  __resetCheckInQueueForTests();
});

describe("I'm safe queue", () => {
  it("saves on the phone first, then sends once", async () => {
    let release: (r: CheckInResult) => void = () => undefined;
    const { transport, calls } = fakeTransport({
      checkIn: (input) => {
        calls.checkIn.push(input);
        return new Promise((resolve) => (release = resolve));
      },
    });
    const item = enqueueCheckIn({ eventKey: KEY, event: EVENT }, transport);
    // Saved before any network answer.
    expect(items()).toHaveLength(1);
    expect(items()[0]?.clientId).toBe(item.clientId);
    await flush();
    expect(items()[0]?.state).toBe("syncing");
    release({ outcome: "sent" });
    await flush();
    expect(items()[0]?.state).toBe("sent");
    expect(calls.checkIn).toHaveLength(1);
    // The prompt for this event is answered.
    expect(useCheckInStore.getState().handled[KEY]).toBeDefined();
  });

  it("the check-in payload carries no location and no device id", async () => {
    const { transport, calls } = fakeTransport();
    enqueueCheckIn({ eventKey: KEY, event: EVENT }, transport);
    await flush();
    expect(Object.keys(calls.checkIn[0] ?? {}).sort()).toEqual([
      "checkedInAt",
      "clientId",
      "eventId",
    ]);
    expect(JSON.stringify(calls.checkIn[0])).not.toMatch(
      /lat|lon|geo|device|35\.3|46\.1/,
    );
  });

  it("offline: stays queued with a retry time, then sends with the SAME client id", async () => {
    let online = false;
    const { transport, calls } = fakeTransport({
      checkIn: async (input) => {
        calls.checkIn.push(input);
        return online
          ? { outcome: "sent" }
          : { outcome: "failed", retryable: true, reason: "network" };
      },
    });
    const item = enqueueCheckIn({ eventKey: KEY, event: EVENT }, transport);
    await flush();
    expect(items()[0]?.state).toBe("queued");
    expect(items()[0]?.nextRetryAt).toBeGreaterThan(Date.now());
    // Not due yet: nothing happens.
    await processCheckInQueue(transport);
    expect(calls.checkIn).toHaveLength(1);
    online = true;
    useCheckInStore.getState()._patch(item.clientId, { nextRetryAt: Date.now() - 1 });
    await processCheckInQueue(transport);
    expect(items()[0]?.state).toBe("sent");
    expect(calls.checkIn.map((c) => c.clientId)).toEqual([item.clientId, item.clientId]);
    // The server event id is resolved once and kept.
    expect(calls.resolve).toBe(1);
  });

  it("an unresolvable event (offline) waits and retries", async () => {
    const { transport, calls } = fakeTransport({ resolveEvent: async () => null });
    enqueueCheckIn({ eventKey: KEY, event: EVENT }, transport);
    await flush();
    expect(items()[0]?.state).toBe("queued");
    expect(calls.checkIn).toHaveLength(0);
  });

  it("terminal failures stop retrying (e.g. the event is too old)", async () => {
    const { transport } = fakeTransport({
      checkIn: async () => ({ outcome: "failed", retryable: false, reason: "event" }),
    });
    enqueueCheckIn({ eventKey: KEY, event: EVENT }, transport);
    await flush();
    expect(items()[0]).toMatchObject({
      state: "failed",
      failure: "event",
      nextRetryAt: null,
    });
  });

  it("Undo before anything was sent: dropped, no server call", async () => {
    const { transport, calls } = fakeTransport();
    const id = enqueueCheckInWithoutDrain();
    undoCheckIn(id, transport);
    expect(items()).toHaveLength(0);
    await flush();
    expect(calls.retract).toHaveLength(0);
    expect(calls.checkIn).toHaveLength(0);
  });

  it("Undo after sending: retracted on the server, then forgotten", async () => {
    const { transport, calls } = fakeTransport();
    const item = enqueueCheckIn({ eventKey: KEY, event: EVENT }, transport);
    await flush();
    expect(items()[0]?.state).toBe("sent");
    undoCheckIn(item.clientId, transport);
    await flush();
    expect(calls.retract).toEqual([item.clientId]);
    expect(items()).toHaveLength(0);
  });

  it("Undo while the check-in is in flight: retracted right after it lands", async () => {
    let release: (r: CheckInResult) => void = () => undefined;
    const { transport, calls } = fakeTransport({
      checkIn: (input) => {
        calls.checkIn.push(input);
        return new Promise((resolve) => (release = resolve));
      },
    });
    const item = enqueueCheckIn({ eventKey: KEY, event: EVENT }, transport);
    await flush();
    undoCheckIn(item.clientId, transport);
    release({ outcome: "sent" });
    await flush();
    await flush();
    expect(calls.retract).toEqual([item.clientId]);
    expect(items()).toHaveLength(0);
  });

  it("the server already has it taken back (Undo overtook it): forgotten", async () => {
    const { transport } = fakeTransport({
      checkIn: async () => ({ outcome: "retracted" }),
    });
    enqueueCheckIn({ eventKey: KEY, event: EVENT }, transport);
    await flush();
    expect(items()).toHaveLength(0);
  });

  it("'Not now' starts the quiet period", () => {
    markPromptHandled(KEY, 5.1, 1000);
    expect(useCheckInStore.getState().lastAction).toEqual({ at: 1000, magnitude: 5.1 });
  });
});

/** Adds a queued item without starting a drain (as if the app was killed
 * right after the tap). */
function enqueueCheckInWithoutDrain(): string {
  useCheckInStore.getState()._add({
    clientId: "never-sent",
    eventKey: KEY,
    event: EVENT,
    serverEventId: null,
    checkedInAt: Date.now(),
    state: "queued",
    attempts: 0,
    nextRetryAt: null,
    failure: null,
    undone: false,
  });
  return "never-sent";
}
