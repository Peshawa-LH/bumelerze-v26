/**
 * Offline feedback queue — mirrors
 * `src/features/felt/__tests__/queue.test.ts`'s own discipline (fresh
 * `require()` after `jest.resetModules()`, since `jest.resetModules()`
 * clears both the module cache AND the AsyncStorage mock's in-memory
 * backing store). Covers the wave brief's own stated acceptance criteria:
 * "the message must never be lost to a weak network" (durable local write
 * before any transport attempt, retry/backoff, survives restart) and "the
 * message must submit successfully even if the photo upload fails or is
 * slow" (a photo failure never touches the surrounding item's own state).
 */

jest.mock("expo-crypto", () => ({
  randomUUID: () => {
    const g = globalThis as { __feedbackQueueTestUuidCounter?: number };
    g.__feedbackQueueTestUuidCounter = (g.__feedbackQueueTestUuidCounter ?? 0) + 1;
    return `test-feedback-uuid-${g.__feedbackQueueTestUuidCounter}`;
  },
}));

jest.mock("@/features/felt", () => ({
  getDeviceId: () => Promise.resolve("device-under-test"),
}));

function loadQueue(): typeof import("../queue") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- must be required fresh after resetModules, inside each test
  return require("../queue");
}

function loadAsyncStorage() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see loadQueue
  return require("@react-native-async-storage/async-storage") as typeof import("@react-native-async-storage/async-storage").default;
}

function itemState(
  store: ReturnType<typeof loadQueue>["useFeedbackQueueStore"],
  feedbackId: string,
) {
  return (
    store.getState().items.find((item) => item.submission.feedbackId === feedbackId)?.state ??
    null
  );
}

/** Looks up ONE photo's upload state (keyed by `photoId`, see `queue.ts`'s
 * `photoStates: Record<string, FeedbackPhotoUploadState>`) — the plural
 * successor to the pre-0021 singular `photoState` helper. */
function photoState(
  store: ReturnType<typeof loadQueue>["useFeedbackQueueStore"],
  feedbackId: string,
  photoId: string,
) {
  return (
    store.getState().items.find((item) => item.submission.feedbackId === feedbackId)
      ?.photoStates[photoId] ?? null
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
 * async) — mirrors `src/features/felt/__tests__/queue.test.ts`'s own
 * `waitForAsync`. */
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

describe("enqueueFeedback + PendingFeedbackTransport (Supabase not configured)", () => {
  it("durably queues the submission locally BEFORE any transport attempt resolves", async () => {
    const { enqueueFeedback, useFeedbackQueueStore } = loadQueue();

    const submission = await enqueueFeedback({
      message: "The map crashed when I tapped a cluster.",
      contact: null,
      screen: "settings",
    });

    const stored = useFeedbackQueueStore
      .getState()
      .items.find((item) => item.submission.feedbackId === submission.feedbackId);
    expect(stored).toBeTruthy();
    expect(stored?.submission.message).toBe("The map crashed when I tapped a cluster.");
    expect(stored?.submission.deviceId).toBe("device-under-test");
  });

  it("settles into 'awaiting-backend' (never 'submitted') when no Supabase project is configured", async () => {
    const queue = loadQueue();

    const submission = await queue.enqueueFeedback({ message: "Idea: dark mode toggle." });

    await waitFor(
      () => itemState(queue.useFeedbackQueueStore, submission.feedbackId) === "awaiting-backend",
    );

    // Env-gating requirement: the queue state driving the confirmation copy
    // must never read "submitted" here — app/feedback.tsx relies on exactly
    // this distinction to avoid telling the user their feedback was sent.
    expect(itemState(queue.useFeedbackQueueStore, submission.feedbackId)).not.toBe("submitted");
  });

  it("persists the queued item to AsyncStorage", async () => {
    const queue = loadQueue();
    const submission = await queue.enqueueFeedback({ message: "Persist me." });

    await waitForAsync(async () => {
      const AsyncStorage = loadAsyncStorage();
      const raw = await AsyncStorage.getItem("bumelerze.feedback.queue");
      return raw !== null && raw.includes(submission.feedbackId);
    });
  });
});

describe("processFeedbackQueue retry/backoff", () => {
  it("retries a retryable failure and eventually reaches 'submitted' once the transport succeeds", async () => {
    const queue = loadQueue();
    const { enqueueFeedback, processFeedbackQueue } = queue;

    let attempt = 0;
    const dateSpy = jest.spyOn(Date, "now");
    let currentTime = 1_700_000_000_000;
    dateSpy.mockImplementation(() => currentTime);

    const flakyTransport: import("../queue").FeedbackTransport = {
      submit: jest.fn(async (submission) => {
        attempt += 1;
        if (attempt === 1) {
          return { outcome: "failed" as const, retryable: true };
        }
        return { outcome: "submitted" as const, serverFeedbackId: submission.feedbackId };
      }),
    };

    const submission = await enqueueFeedback({ message: "Retry me." }, flakyTransport);

    // First attempt fails and schedules a backoff retry.
    await waitFor(() => itemState(queue.useFeedbackQueueStore, submission.feedbackId) === "failed");
    expect(flakyTransport.submit).toHaveBeenCalledTimes(1);

    // Immediately re-processing before the backoff window elapses must NOT
    // re-attempt yet (this is what makes it "backoff", not a hot loop).
    await processFeedbackQueue(flakyTransport);
    expect(flakyTransport.submit).toHaveBeenCalledTimes(1);

    // Advance past the backoff window and re-trigger (simulates the next
    // app-foreground sync) — now it succeeds.
    currentTime += 10 * 60_000;
    await processFeedbackQueue(flakyTransport);
    await waitFor(
      () => itemState(queue.useFeedbackQueueStore, submission.feedbackId) === "submitted",
    );
    expect(flakyTransport.submit).toHaveBeenCalledTimes(2);
  });

  it("never drops the submission on a non-retryable failure — it stays visible as 'failed'", async () => {
    const queue = loadQueue();
    const transport: import("../queue").FeedbackTransport = {
      submit: jest.fn(async () => ({ outcome: "failed" as const, retryable: false })),
    };

    const submission = await queue.enqueueFeedback({ message: "Terminal failure." }, transport);
    await waitFor(() => itemState(queue.useFeedbackQueueStore, submission.feedbackId) === "failed");

    const stored = queue.useFeedbackQueueStore
      .getState()
      .items.find((item) => item.submission.feedbackId === submission.feedbackId);
    expect(stored?.nextRetryAt).toBeNull();
    expect(stored?.submission.message).toBe("Terminal failure.");
  });
});

describe("survives an app restart", () => {
  it("re-hydrates the same queued item from AsyncStorage after a simulated restart", async () => {
    const session1 = loadQueue();
    const submission = await session1.enqueueFeedback(
      { message: "Restart me." },
      { submit: () => Promise.resolve({ outcome: "awaiting-backend" as const }) },
    );
    await waitForAsync(async () => {
      const AsyncStorage = loadAsyncStorage();
      const raw = await AsyncStorage.getItem("bumelerze.feedback.queue");
      return raw !== null && raw.includes(submission.feedbackId);
    });

    const AsyncStorage = loadAsyncStorage();
    const persisted = await AsyncStorage.getItem("bumelerze.feedback.queue");

    jest.resetModules();
    const AsyncStorage2 = loadAsyncStorage();
    if (persisted) {
      await AsyncStorage2.setItem("bumelerze.feedback.queue", persisted);
    }

    // `useFeedbackQueueHasHydrated`/`useFeedbackQueueStore` are React hooks
    // (zustand's hook form) — cannot be invoked directly from test code
    // outside a render, matching `src/features/felt/__tests__/queue.test.ts`'s
    // own comment on this exact point. Read hydration via the plain
    // (non-hook) `getState()` accessor instead.
    const session2 = loadQueue();
    await waitFor(() => session2.useFeedbackQueueStore.getState().hasHydrated);

    const rehydrated = session2.useFeedbackQueueStore
      .getState()
      .items.find((item) => item.submission.feedbackId === submission.feedbackId);
    expect(rehydrated?.submission.message).toBe("Restart me.");
  });
});

describe("processFeedbackQueue photo-upload pass", () => {
  function transportWithPhoto(
    submitResult: import("../queue").FeedbackTransportResult = {
      outcome: "submitted",
      serverFeedbackId: "unused",
    },
    uploadOutcome: "uploaded" | "failed" = "uploaded",
  ) {
    const submit = jest.fn(async (submission: import("../types").FeedbackSubmission) =>
      submitResult.outcome === "submitted"
        ? { outcome: "submitted" as const, serverFeedbackId: submission.feedbackId }
        : submitResult,
    );
    const uploadPhoto = jest.fn(async () => ({ outcome: uploadOutcome }));
    return { submit, uploadPhoto };
  }

  it("does not attempt a photo upload while the submission is still queued/syncing", async () => {
    const queue = loadQueue();
    const transport = transportWithPhoto({ outcome: "failed", retryable: true });

    const submission = await queue.enqueueFeedback(
      { message: "With photo.", photoUris: ["file:///tmp/shot.jpg"] },
      transport,
    );
    await waitFor(() => itemState(queue.useFeedbackQueueStore, submission.feedbackId) === "failed");

    expect(transport.uploadPhoto).not.toHaveBeenCalled();
    expect(
      photoState(queue.useFeedbackQueueStore, submission.feedbackId, submission.photos[0]!.photoId),
    ).toBe("pending-upload");
  });

  it("uploads the photo once the message reaches 'submitted', in the SAME drain", async () => {
    const queue = loadQueue();
    const transport = transportWithPhoto();

    const submission = await queue.enqueueFeedback(
      { message: "With photo.", photoUris: ["file:///tmp/shot.jpg"] },
      transport,
    );

    await waitFor(
      () =>
        photoState(queue.useFeedbackQueueStore, submission.feedbackId, submission.photos[0]!.photoId) ===
        "uploaded",
    );
    expect(transport.uploadPhoto).toHaveBeenCalledTimes(1);
    expect(transport.uploadPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ feedbackId: submission.feedbackId }),
      submission.photos[0],
    );
  });

  it("marks that photo's state 'failed' on an upload failure without affecting the message's own 'submitted' state", async () => {
    const queue = loadQueue();
    const transport = transportWithPhoto(
      { outcome: "submitted", serverFeedbackId: "unused" },
      "failed",
    );

    const submission = await queue.enqueueFeedback(
      { message: "Photo fails, message must not.", photoUris: ["file:///tmp/shot.jpg"] },
      transport,
    );

    await waitFor(
      () =>
        photoState(queue.useFeedbackQueueStore, submission.feedbackId, submission.photos[0]!.photoId) ===
        "failed",
    );
    expect(itemState(queue.useFeedbackQueueStore, submission.feedbackId)).toBe("submitted");
  });

  it("retries a failed photo upload on the next drain", async () => {
    const queue = loadQueue();
    let uploadAttempt = 0;
    const transport: import("../queue").FeedbackTransport = {
      submit: jest.fn(async (submission) => ({
        outcome: "submitted" as const,
        serverFeedbackId: submission.feedbackId,
      })),
      uploadPhoto: jest.fn(async () => {
        uploadAttempt += 1;
        return { outcome: uploadAttempt === 1 ? ("failed" as const) : ("uploaded" as const) };
      }),
    };

    const submission = await queue.enqueueFeedback(
      { message: "Retry the photo.", photoUris: ["file:///tmp/shot.jpg"] },
      transport,
    );
    await waitFor(
      () =>
        photoState(queue.useFeedbackQueueStore, submission.feedbackId, submission.photos[0]!.photoId) ===
        "failed",
    );

    await queue.processFeedbackQueue(transport);
    await waitFor(
      () =>
        photoState(queue.useFeedbackQueueStore, submission.feedbackId, submission.photos[0]!.photoId) ===
        "uploaded",
    );
    expect(uploadAttempt).toBe(2);
  });

  it("never calls uploadPhoto (and never crashes) when the transport doesn't implement it", async () => {
    const queue = loadQueue();
    const transport: import("../queue").FeedbackTransport = {
      submit: jest.fn(async (submission) => ({
        outcome: "submitted" as const,
        serverFeedbackId: submission.feedbackId,
      })),
    };

    const submission = await queue.enqueueFeedback(
      { message: "No uploadPhoto on this transport.", photoUris: ["file:///tmp/shot.jpg"] },
      transport,
    );

    await waitFor(() => itemState(queue.useFeedbackQueueStore, submission.feedbackId) === "submitted");
    // photoState stays whatever it was seeded as — never crashes trying to
    // call an uploadPhoto that doesn't exist.
    expect(
      photoState(queue.useFeedbackQueueStore, submission.feedbackId, submission.photos[0]!.photoId),
    ).toBe("pending-upload");
  });

  it("never attempts a photo upload when there are no photoUris", async () => {
    const queue = loadQueue();
    const transport = transportWithPhoto();

    const submission = await queue.enqueueFeedback({ message: "No photo at all." }, transport);
    await waitFor(() => itemState(queue.useFeedbackQueueStore, submission.feedbackId) === "submitted");

    expect(transport.uploadPhoto).not.toHaveBeenCalled();
    expect(submission.photos).toEqual([]);
  });

  it("uploads several photos independently, one permanent failure never blocking or retrying the others", async () => {
    const queue = loadQueue();
    const outcomeByUri: Record<string, "uploaded" | "failed"> = {
      "file:///tmp/one.jpg": "uploaded",
      "file:///tmp/two.jpg": "failed",
      "file:///tmp/three.jpg": "uploaded",
    };
    const transport: import("../queue").FeedbackTransport = {
      submit: jest.fn(async (submission) => ({
        outcome: "submitted" as const,
        serverFeedbackId: submission.feedbackId,
      })),
      uploadPhoto: jest.fn(async (_submission, photo: import("../types").FeedbackPhotoAttachment) => ({
        outcome: outcomeByUri[photo.uri] ?? "failed",
      })),
    };

    const submission = await queue.enqueueFeedback(
      {
        message: "Three photos, one bad.",
        photoUris: ["file:///tmp/one.jpg", "file:///tmp/two.jpg", "file:///tmp/three.jpg"],
      },
      transport,
    );
    expect(submission.photos).toHaveLength(3);
    const [photoOne, photoTwo, photoThree] = submission.photos;

    await waitFor(
      () =>
        photoState(queue.useFeedbackQueueStore, submission.feedbackId, photoOne!.photoId) === "uploaded" &&
        photoState(queue.useFeedbackQueueStore, submission.feedbackId, photoTwo!.photoId) === "failed" &&
        photoState(queue.useFeedbackQueueStore, submission.feedbackId, photoThree!.photoId) === "uploaded",
    );

    // The failing photo's own retry (backoff-free at the per-photo layer,
    // see queue.ts) never re-attempts an already-uploaded sibling.
    const callsForPhotoOne = (transport.uploadPhoto as jest.Mock).mock.calls.filter(
      ([, photo]: [unknown, import("../types").FeedbackPhotoAttachment]) =>
        photo.photoId === photoOne!.photoId,
    );
    expect(callsForPhotoOne).toHaveLength(1);
    expect(itemState(queue.useFeedbackQueueStore, submission.feedbackId)).toBe("submitted");
  });

  it("truncates photoUris to FEEDBACK_PHOTO_MAX_COUNT defensively, even if a caller bypasses the UI cap", async () => {
    const queue = loadQueue();
    const transport = transportWithPhoto();
    const tooMany = Array.from({ length: queue.FEEDBACK_PHOTO_MAX_COUNT + 3 }, (_, i) => `file:///tmp/${i}.jpg`);

    const submission = await queue.enqueueFeedback({ message: "Too many.", photoUris: tooMany }, transport);

    expect(submission.photos).toHaveLength(queue.FEEDBACK_PHOTO_MAX_COUNT);
  });

  it("re-draining after a full upload is a no-op: no duplicate uploadPhoto calls for already-uploaded photos", async () => {
    const queue = loadQueue();
    const transport = transportWithPhoto();

    const submission = await queue.enqueueFeedback(
      { message: "Idempotent re-drain.", photoUris: ["file:///tmp/one.jpg", "file:///tmp/two.jpg"] },
      transport,
    );
    await waitFor(
      () =>
        photoState(queue.useFeedbackQueueStore, submission.feedbackId, submission.photos[0]!.photoId) ===
          "uploaded" &&
        photoState(queue.useFeedbackQueueStore, submission.feedbackId, submission.photos[1]!.photoId) ===
          "uploaded",
    );
    expect(transport.uploadPhoto).toHaveBeenCalledTimes(2);

    await queue.processFeedbackQueue(transport);
    await queue.processFeedbackQueue(transport);

    // Neither already-"uploaded" photo is re-attempted on a later drain.
    expect(transport.uploadPhoto).toHaveBeenCalledTimes(2);
  });
});
