/**
 * What a sign-out does on the device (security audit APP-04), against the
 * real stores: everything of the previous person goes (sent items and
 * "My reports" too), the device's own settings stay, the device id is new,
 * and "unsent" counts exactly what a sign-out would delete.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient } from "@tanstack/react-query";
import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";

import { useHomePhotoQueueStore, type QueuedPhoto } from "@/features/building/photo-queue";
import { useFeedbackQueueStore, type FeedbackQueueItem } from "@/features/feedback/queue";
import { __resetDeviceIdCacheForTests, getDeviceId } from "@/features/felt/device-id";
import { useFeltQueueStore, type FeltTransport, type QueueItem } from "@/features/felt/queue";
import { useTier2DraftStore } from "@/features/felt/tier2-draft-store";
import { useArrivedLinkStore, usePendingLinkStore } from "@/features/links/pending-link";
import { useCheckInStore, type CheckInItem } from "@/features/safe/queue";
import {
  __resetSessionQueryCacheForTests,
  registerSessionQueryCache,
} from "@/lib/session-query-cache";

import {
  __resetHandoverForTests,
  hasHandoverToken,
  prepareHandover,
} from "../handover";
import { clearPersonalDataOnDevice, countUnsentItems, sendWaitingItems } from "../sign-out-data";

jest.mock("expo-crypto", () => ({
  randomUUID: () => {
    const g = globalThis as { __signOutUuid?: number };
    g.__signOutUuid = (g.__signOutUuid ?? 0) + 1;
    return `new-device-${g.__signOutUuid}`;
  },
}));

const mockReleaseAllPhotos = jest.fn();
jest.mock("@/lib/durable-photo-uri", () => ({
  ...jest.requireActual("@/lib/durable-photo-uri"),
  releaseAllDurablePhotos: () => mockReleaseAllPhotos(),
}));

// The felt queue's send pass: the real one unless a test says otherwise.
const mockProcessQueue = jest.fn();
jest.mock("@/features/felt/queue", () => {
  const actual = jest.requireActual("@/features/felt/queue");
  return { ...actual, processQueue: (...args: unknown[]) => mockProcessQueue(...args) };
});
const actualFeltQueue = jest.requireActual<typeof import("@/features/felt/queue")>(
  "@/features/felt/queue",
);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function report(id: string, overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    tier1: {
      reportId: id,
      deviceId: "old-device-id",
      eventId: null,
      eventRegistration: null,
      cartoonLevel: 3,
      location: { lat: 36.19, lon: 44.01, quality: "gps" },
      feltAt: 1,
      createdAt: 1,
      submittedAt: null,
    },
    tier2: null,
    state: "queued",
    attempts: 0,
    lastAttemptAt: null,
    nextRetryAt: null,
    photoState: null,
    ...overrides,
  } as QueueItem;
}

function feedback(id: string, overrides: Partial<FeedbackQueueItem> = {}): FeedbackQueueItem {
  return {
    submission: {
      feedbackId: id,
      deviceId: "old-device-id",
      message: "hello",
      contact: "me@example.com",
      context: { appVersion: "1", locale: "en", platform: "web" },
      photos: [],
      createdAt: 1,
    },
    state: "queued",
    attempts: 0,
    lastAttemptAt: null,
    nextRetryAt: null,
    photoStates: {},
    ...overrides,
  };
}

function checkIn(id: string, overrides: Partial<CheckInItem> = {}): CheckInItem {
  return {
    clientId: id,
    eventKey: "usgs:us1",
    event: null,
    feltReportId: null,
    told: null,
    serverEventId: null,
    checkedInAt: Date.now(),
    state: "queued",
    attempts: 0,
    nextRetryAt: null,
    failure: null,
    undone: false,
    ...overrides,
  };
}

function homePhoto(id: string): QueuedPhoto {
  return {
    id,
    tagId: "tag-1",
    uri: `file:///docs/photos/${id}.jpg`,
    slot: "front",
    caption: "",
    fileName: `${id}.jpg`,
    createdAt: 1,
    failures: 0,
    attempts: 0,
    nextRetryAt: null,
  } as QueuedPhoto;
}

function resetStores(): void {
  useFeltQueueStore.setState({ items: [] });
  useFeedbackQueueStore.setState({ items: [] });
  useCheckInStore.setState({ items: [], handled: {}, lastAction: null });
  useHomePhotoQueueStore.setState({ items: [] });
  usePendingLinkStore.setState({ pending: null, savedAt: null });
  useArrivedLinkStore.setState({ arrived: null });
  useTier2DraftStore.getState().reset();
}

/** Lets zustand's persist writes reach the (mocked) AsyncStorage. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockProcessQueue.mockImplementation((...args: unknown[]) =>
    actualFeltQueue.processQueue(...(args as [FeltTransport?])),
  );
  resetStores();
  __resetHandoverForTests();
  __resetSessionQueryCacheForTests();
  await AsyncStorage.clear();
  __resetDeviceIdCacheForTests();
});

// ---------------------------------------------------------------------------
// clearPersonalDataOnDevice
// ---------------------------------------------------------------------------

describe("clearPersonalDataOnDevice", () => {
  async function seedEverything() {
    await AsyncStorage.setItem("bumelerze.device-id", "old-device-id");
    expect(await getDeviceId()).toBe("old-device-id");

    useFeltQueueStore.setState({
      items: [
        report("queued-1"),
        report("sent-1", { state: "submitted", tier1: { ...report("x").tier1, reportId: "sent-1", submittedAt: 2 } }),
      ],
    });
    useFeedbackQueueStore.setState({
      items: [feedback("fb-1"), feedback("fb-2", { state: "submitted" })],
    });
    useCheckInStore.setState({
      items: [checkIn("safe-1"), checkIn("safe-2", { state: "sent" })],
      handled: { "usgs:us1": Date.now() },
      lastAction: { at: Date.now(), magnitude: 5.1 },
    });
    useHomePhotoQueueStore.setState({ items: [homePhoto("p1")] });
    usePendingLinkStore.getState().keep("/e/abc", Date.now());
    useArrivedLinkStore.getState().setArrived("/home/join?k=secret");
    useTier2DraftStore.getState().initDraft("queued-1", null);
    useTier2DraftStore.getState().setPhotoUri("file:///docs/photos/draft.jpg");

    const client = {
      auth: { getSession: async () => ({ data: { session: { user: { is_anonymous: true } } } }) },
      rpc: async () => ({ data: "cd".repeat(32), error: null }),
    };
    await prepareHandover(client as never);
    expect(hasHandoverToken()).toBe(true);

    // This device's settings: must survive.
    await AsyncStorage.multiSet([
      ["bumelerze.language", "ckb"],
      ["bumelerze.prefs", JSON.stringify({ state: { onboardingCompleted: true }, version: 3 })],
      ["bumelerze.theme-preferences", JSON.stringify({ state: { mode: "dark" } })],
      ["bumelerze.map-preferences", JSON.stringify({ state: { layer: "sat" } })],
      ["bumelerze-alert-device", JSON.stringify({ state: { deviceOn: true } })],
      ["bumelerze.presence.last-touch", "123"],
    ]);
    await settle();
  }

  it("[APP-04] empties every queue, sent items and 'My reports' included, on the device too", async () => {
    await seedEverything();
    await clearPersonalDataOnDevice();
    await settle();

    expect(useFeltQueueStore.getState().items).toEqual([]);
    expect(useFeedbackQueueStore.getState().items).toEqual([]);
    expect(useCheckInStore.getState()).toMatchObject({ items: [], handled: {}, lastAction: null });
    expect(useHomePhotoQueueStore.getState().items).toEqual([]);

    const stored = async (key: string) =>
      JSON.parse((await AsyncStorage.getItem(key)) ?? "{}") as { state?: Record<string, unknown> };
    expect((await stored("bumelerze.felt.queue")).state?.items).toEqual([]);
    expect((await stored("bumelerze.feedback.queue")).state?.items).toEqual([]);
    expect((await stored("bumelerze.safe.checkins")).state).toMatchObject({
      items: [],
      handled: {},
      lastAction: null,
    });
    expect((await stored("bumelerze.home.photoQueue")).state?.items).toEqual([]);
  });

  it("[APP-04] deletes the kept photo files, the kept link, the details draft and the handover token", async () => {
    await seedEverything();
    await clearPersonalDataOnDevice();
    await settle();

    expect(mockReleaseAllPhotos).toHaveBeenCalledTimes(1);
    expect(usePendingLinkStore.getState()).toMatchObject({ pending: null, savedAt: null });
    expect(useArrivedLinkStore.getState().arrived).toBeNull();
    expect(useTier2DraftStore.getState()).toMatchObject({ feltReportId: null, photoUri: null });
    expect(hasHandoverToken()).toBe(false);
    const link = JSON.parse((await AsyncStorage.getItem("bumelerze.pending-link")) ?? "{}");
    expect(link.state).toMatchObject({ pending: null, savedAt: null });
  });

  it("[APP-04] gives the device a new id, at once and on the phone", async () => {
    await seedEverything();
    await clearPersonalDataOnDevice();

    const next = await getDeviceId();
    expect(next).not.toBe("old-device-id");
    expect(next).toMatch(/^new-device-/);
    expect(await AsyncStorage.getItem("bumelerze.device-id")).toBe(next);
    // Survives a restart (a fresh read from storage).
    __resetDeviceIdCacheForTests();
    expect(await getDeviceId()).toBe(next);
  });

  it("[APP-04] removes the person's React Query answers, in memory and on the device, and keeps the public feed", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    client.setQueryData(["account", "stats", "u1"], { name: "Shilan" });
    client.setQueryData(["events", "region"], [{ id: "us7000abcd" }]);
    let saved: PersistedClient | undefined;
    const persister: Persister = {
      persistClient: jest.fn((next: PersistedClient) => {
        saved = next;
      }),
      restoreClient: jest.fn(async () => saved),
      removeClient: jest.fn(),
    };
    registerSessionQueryCache(client, persister, { buster: "events-v1" });

    await clearPersonalDataOnDevice();

    expect(client.getQueryData(["account", "stats", "u1"])).toBeUndefined();
    expect(client.getQueryData(["events", "region"])).toEqual([{ id: "us7000abcd" }]);
    expect(saved?.clientState.queries.map((query) => query.queryKey)).toEqual([
      ["events", "region"],
    ]);
    expect(persister.removeClient).not.toHaveBeenCalled();
  });

  it("keeps this device's settings: language, onboarding, appearance, map, alerts, last-seen stamp", async () => {
    await seedEverything();
    await clearPersonalDataOnDevice();
    await settle();

    expect(await AsyncStorage.getItem("bumelerze.language")).toBe("ckb");
    for (const key of [
      "bumelerze.prefs",
      "bumelerze.theme-preferences",
      "bumelerze.map-preferences",
      "bumelerze-alert-device",
      "bumelerze.presence.last-touch",
    ]) {
      expect(await AsyncStorage.getItem(key)).not.toBeNull();
    }
  });

  it("one failing step never stops the others", async () => {
    await AsyncStorage.setItem("bumelerze.device-id", "old-device-id");
    useFeltQueueStore.setState({ items: [report("r1")] });
    mockReleaseAllPhotos.mockImplementationOnce(() => {
      throw new Error("disk");
    });
    const persister: Persister = {
      persistClient: jest.fn(),
      restoreClient: jest.fn(async () => {
        throw new Error("storage");
      }),
      removeClient: jest.fn(async () => {
        throw new Error("storage");
      }),
    };
    registerSessionQueryCache(
      new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } }),
      persister,
      { buster: "events-v1" },
    );

    await expect(clearPersonalDataOnDevice()).resolves.toBeUndefined();
    expect(useFeltQueueStore.getState().items).toEqual([]);
    expect(await getDeviceId()).not.toBe("old-device-id");
  });
});

// ---------------------------------------------------------------------------
// countUnsentItems
// ---------------------------------------------------------------------------

describe("countUnsentItems", () => {
  it("counts what a sign-out would delete before it reached the server", () => {
    useFeltQueueStore.setState({
      items: [
        report("queued"),
        report("failed", { state: "failed", nextRetryAt: Date.now() + 60_000 }),
        report("syncing", { state: "syncing" }),
        report("photo-pending", { state: "submitted", photoState: "pending-upload" }),
        // Not counted: on the server, or withdrawn (never sent).
        report("sent", { state: "submitted" }),
        report("sent-with-photo", { state: "submitted", photoState: "uploaded" }),
        report("withdrawn", { withdrawnAt: Date.now() }),
      ],
    });
    useFeedbackQueueStore.setState({
      items: [
        feedback("fb-queued"),
        feedback("fb-photo", { state: "submitted", photoStates: { a: "failed" } }),
        feedback("fb-sent", { state: "submitted", photoStates: { a: "uploaded" } }),
      ],
    });
    useCheckInStore.setState({
      items: [
        checkIn("safe-queued"),
        checkIn("safe-undo", { state: "sent", undone: true }),
        checkIn("safe-retry", { state: "failed", nextRetryAt: Date.now() + 1000 }),
        // Not counted: sent, or refused for good.
        checkIn("safe-sent", { state: "sent" }),
        checkIn("safe-refused", { state: "failed", nextRetryAt: null }),
      ],
    });
    useHomePhotoQueueStore.setState({ items: [homePhoto("p1"), homePhoto("p2")] });

    expect(countUnsentItems()).toBe(4 + 2 + 3 + 2);
  });

  it("is 0 on a device with nothing waiting", () => {
    useFeltQueueStore.setState({ items: [report("sent", { state: "submitted" })] });
    expect(countUnsentItems()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// sendWaitingItems
// ---------------------------------------------------------------------------

describe("sendWaitingItems", () => {
  it("does nothing at all when nothing waits", async () => {
    useFeltQueueStore.setState({ items: [report("sent", { state: "submitted" })] });
    await expect(sendWaitingItems(1000)).resolves.toBe(0);
    expect(mockProcessQueue).not.toHaveBeenCalled();
  });

  it("tries once more now, retry delays skipped, and answers what is still unsent", async () => {
    const later = Date.now() + 10 * 60_000;
    useFeltQueueStore.setState({
      items: [report("a"), report("b", { state: "failed", attempts: 3, nextRetryAt: later })],
    });
    let dueAtSend: (number | null)[] = [];
    mockProcessQueue.mockImplementation(async () => {
      const items = useFeltQueueStore.getState().items;
      dueAtSend = items.map((item) => item.nextRetryAt);
      // The server takes "a" only.
      useFeltQueueStore.setState({
        items: items.map((item) =>
          item.tier1.reportId === "a" ? { ...item, state: "submitted" as const } : item,
        ),
      });
    });

    await expect(sendWaitingItems(1000)).resolves.toBe(1);
    expect(mockProcessQueue).toHaveBeenCalledTimes(1);
    for (const due of dueAtSend) {
      expect(due === null || due <= Date.now()).toBe(true);
    }
  });

  it("answers 0 when everything went", async () => {
    useFeltQueueStore.setState({ items: [report("a")] });
    useFeedbackQueueStore.setState({ items: [] });
    mockProcessQueue.mockImplementation(async () => {
      useFeltQueueStore.setState({
        items: useFeltQueueStore.getState().items.map((item) => ({
          ...item,
          state: "submitted" as const,
        })),
      });
    });
    await expect(sendWaitingItems(1000)).resolves.toBe(0);
  });

  it("[APP-04] gives up after the time limit and counts what is still waiting", async () => {
    useFeltQueueStore.setState({ items: [report("a")] });
    mockProcessQueue.mockImplementation(() => new Promise(() => undefined));
    const started = Date.now();
    await expect(sendWaitingItems(60)).resolves.toBe(1);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("waits for a send pass that was already running, within the time limit", async () => {
    useFeltQueueStore.setState({ items: [report("a")] });
    // A pass already under way with a slow connection (the app's own drain).
    let release: () => void = () => undefined;
    const slow: FeltTransport = {
      submitTier1: () =>
        new Promise((resolve) => {
          release = () => resolve({ outcome: "submitted", serverReportId: "a" });
        }),
      submitTier2: async () => ({ outcome: "submitted", serverReportId: "a" }),
    };
    const running = actualFeltQueue.processQueue(slow);
    expect(actualFeltQueue.isFeltQueueSending()).toBe(true);

    const result = sendWaitingItems(2000);
    setTimeout(() => release(), 50);
    await expect(result).resolves.toBe(0);
    await running;
  });

  it("never throws", async () => {
    useFeltQueueStore.setState({ items: [report("a")] });
    mockProcessQueue.mockImplementation(() => {
      throw new Error("boom");
    });
    await expect(sendWaitingItems(100)).resolves.toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Nothing cleared by a sign-out is sent afterwards
// ---------------------------------------------------------------------------

describe("[APP-04] a queue cleared while an earlier item is being sent sends nothing more", () => {
  it("feedback: the second message is never sent (it would go under the next identity)", async () => {
    const { processFeedbackQueue } = jest.requireActual<
      typeof import("@/features/feedback/queue")
    >("@/features/feedback/queue");
    useFeedbackQueueStore.setState({ items: [feedback("fb-1"), feedback("fb-2")] });
    let release: () => void = () => undefined;
    const submit = jest.fn(
      (submission: { feedbackId: string }) =>
        new Promise<{ outcome: "submitted" }>((resolve) => {
          if (submission.feedbackId === "fb-1") {
            release = () => resolve({ outcome: "submitted" });
          } else {
            resolve({ outcome: "submitted" });
          }
        }),
    );
    const pass = processFeedbackQueue({ submit } as never);
    await settle();
    expect(submit).toHaveBeenCalledTimes(1);

    await clearPersonalDataOnDevice();
    release();
    await pass;

    expect(submit.mock.calls.map(([s]) => s.feedbackId)).toEqual(["fb-1"]);
    expect(useFeedbackQueueStore.getState().items).toEqual([]);
  });

  it("felt reports: a photo still to upload is not uploaded after the clear", async () => {
    const withPhoto = (id: string) =>
      report(id, {
        state: "submitted",
        photoState: "pending-upload",
        tier2: { photoUri: `data:image/jpeg;base64,${id}` } as QueueItem["tier2"],
      });
    useFeltQueueStore.setState({ items: [withPhoto("r1"), withPhoto("r2")] });
    let release: () => void = () => undefined;
    const uploadPhoto = jest.fn(
      (tier2: { photoUri: string | null }) =>
        new Promise<{ outcome: "uploaded" }>((resolve) => {
          if (tier2.photoUri?.endsWith("r1")) {
            release = () => resolve({ outcome: "uploaded" });
          } else {
            resolve({ outcome: "uploaded" });
          }
        }),
    );
    const transport = {
      submitTier1: jest.fn(),
      submitTier2: jest.fn(),
      uploadPhoto,
    } as unknown as FeltTransport;
    const pass = actualFeltQueue.processQueue(transport);
    await settle();
    expect(uploadPhoto).toHaveBeenCalledTimes(1);

    await clearPersonalDataOnDevice();
    release();
    await pass;

    expect(uploadPhoto).toHaveBeenCalledTimes(1);
  });
});
