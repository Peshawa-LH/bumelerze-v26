import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { AppState, type AppStateStatus } from "react-native";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { getDeviceId } from "@/features/felt";
import { isSupabaseConfigured } from "@/lib/supabase";

import { buildFeedbackContext } from "./context";
// A real (value) import, not `import type` — this IS the transport selected
// at runtime below, same reasoning `src/features/felt/queue.ts` documents
// on its own equivalent import: no circular-dependency risk since
// `supabase-transport.ts` only imports types FROM this file.
import { SupabaseFeedbackTransport } from "./supabase-transport";
import type { FeedbackPhotoAttachment, FeedbackSubmission } from "./types";

/**
 * Offline-first feedback submission queue — mirrors
 * `src/features/felt/queue.ts`'s own pattern (durable local write BEFORE
 * any network attempt, zustand + AsyncStorage persistence, foreground-
 * triggered retry with capped exponential backoff, a photo-upload pass
 * independent of and never blocking the message). A deliberate PARALLEL
 * implementation, not a shared/generalized module: feedback and felt
 * reports are unrelated domains that happen to need the same offline
 * shape — coupling them behind one generic queue would make either one
 * harder to reason about for the wrong reason (a false sense of shared
 * business logic that doesn't actually exist).
 *
 * Owner's own words (the reason this exists): "In the settings tab we can
 * implement a feedback message where you press feedback then write a
 * message ... I can get the list of feedback then share them with you for
 * fixes." The queue's whole job is making sure that message is never lost
 * to a weak network between the tap and the eventual sync.
 */

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export type FeedbackTransportResult =
  | { outcome: "submitted"; serverFeedbackId: string }
  /** No backend exists to hand off to yet — NOT a failure: nothing was
   * attempted, nothing was lost. Mirrors `TransportResult`'s own
   * "awaiting-backend" case (`src/features/felt/queue.ts`). */
  | { outcome: "awaiting-backend" }
  | { outcome: "failed"; retryable: boolean };

/** Result of a screenshot upload attempt — a separate, simpler result type
 * from `FeedbackTransportResult`, same split `PhotoUploadResult` makes: an
 * upload never blocks or retries the surrounding message. */
export type FeedbackPhotoUploadResult = { outcome: "uploaded" } | { outcome: "failed" };

export interface FeedbackTransport {
  submit(submission: FeedbackSubmission): Promise<FeedbackTransportResult>;
  /** Optional — only `SupabaseFeedbackTransport` implements this.
   * `PendingFeedbackTransport` omits it; `processFeedbackQueue`'s
   * photo-upload pass checks `typeof transport.uploadPhoto === "function"`
   * before calling it, so omitting it is "not attempted yet", never a
   * crash. Takes ONE `photo` at a time (not the whole submission's photo
   * list) so each photo uploads, fails, and retries completely
   * independently of its siblings — the wave-2 requirement that one bad
   * photo in a set of several must never block or mark-failed the others. */
  uploadPhoto?(
    submission: FeedbackSubmission,
    photo: FeedbackPhotoAttachment,
  ): Promise<FeedbackPhotoUploadResult>;
}

/**
 * The fallback transport for whenever no Supabase project is configured.
 * Every submission stays queued locally, forever, in the
 * "awaiting-backend" state — matching `PendingTransport`'s own contract
 * (`src/features/felt/queue.ts`). `app/feedback.tsx`'s confirmation copy
 * reads the live queue state (never "submitted" under this transport) so
 * the user is never told their feedback was sent when it has nowhere to go
 * (env-gating requirement).
 */
export const PendingFeedbackTransport: FeedbackTransport = {
  submit: () => Promise.resolve({ outcome: "awaiting-backend" }),
};

/**
 * Resolves the transport every exported queue function below defaults to
 * when a caller doesn't pass one explicitly — mirrors
 * `getDefaultFeltTransport`'s own "a function, not a module-load-time
 * constant" reasoning (tests toggle `process.env` between cases without a
 * full module remount).
 */
export function getDefaultFeedbackTransport(): FeedbackTransport {
  return isSupabaseConfigured() ? SupabaseFeedbackTransport : PendingFeedbackTransport;
}

// ---------------------------------------------------------------------------
// Queue store
// ---------------------------------------------------------------------------

export type FeedbackQueueItemState =
  | "queued" // written locally, not yet attempted (or needs a re-attempt)
  | "syncing" // an attempt is in flight right now
  | "awaiting-backend" // reached the transport layer; see PendingFeedbackTransport
  | "submitted" // a real transport confirmed server receipt
  | "failed"; // the transport reported a retryable (or terminal) failure

/** Screenshot upload state, independent of `FeedbackQueueItemState` above —
 * mirrors `PhotoUploadState` (`src/features/felt/queue.ts`). Tracked per
 * PHOTO (keyed by `FeedbackPhotoAttachment.photoId`), not per submission,
 * since 0021 allows several: an item with no photos has an empty
 * `photoStates` map. `processFeedbackQueue`'s photo-upload pass only
 * attempts an upload once the surrounding item's `state` is "submitted"
 * (the `feedback_photos.feedback_id` foreign key needs the `feedback` row
 * to exist first) and retries "failed" independently, per photo, on every
 * subsequent drain. */
export type FeedbackPhotoUploadState = "pending-upload" | "uploaded" | "failed";

/** The cap this wave chose: 5 screenshots per submission. Enforced in the
 * UI (`app/feedback.tsx`, non-scolding "you've reached the limit" copy
 * rather than a rejected submission) and defensively re-applied here in
 * `enqueueFeedback` in case a future caller ever bypasses that UI. Five
 * covers the stated use case (a tester with "several screenshots" of one
 * visual bug) with headroom, while still keeping a single feedback
 * submission — and its upload burst on a possibly-weak network — bounded:
 * unlike `felt_photos` this bucket has no per-report moderation queue to
 * lean on, so the limit is the only backstop against an unbounded upload
 * batch. */
export const FEEDBACK_PHOTO_MAX_COUNT = 5;

export interface FeedbackQueueItem {
  submission: FeedbackSubmission;
  state: FeedbackQueueItemState;
  attempts: number;
  lastAttemptAt: number | null;
  nextRetryAt: number | null;
  /** Keyed by `FeedbackPhotoAttachment.photoId` — see
   * `FeedbackPhotoUploadState`'s own doc above. */
  photoStates: Record<string, FeedbackPhotoUploadState>;
}

const FEEDBACK_QUEUE_STORAGE_KEY = "bumelerze.feedback.queue";
const INITIAL_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 10 * 60_000;

function computeBackoffMs(attempts: number): number {
  return Math.min(INITIAL_BACKOFF_MS * 2 ** attempts, MAX_BACKOFF_MS);
}

interface FeedbackQueueState {
  items: FeedbackQueueItem[];
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
  _addItem: (item: FeedbackQueueItem) => void;
  _patchItem: (feedbackId: string, patch: Partial<FeedbackQueueItem>) => void;
  /** Patches a SINGLE photo's upload state without touching any sibling
   * photo's state — the store-level half of "one photo failing must never
   * affect the others" (the other half is `processFeedbackQueue`'s
   * per-photo `try`/`catch` in its upload pass, below). */
  _patchPhotoState: (
    feedbackId: string,
    photoId: string,
    photoState: FeedbackPhotoUploadState,
  ) => void;
}

/** Internal — screens/hooks should go through the exported functions below,
 * not call store actions (prefixed `_`) directly. Exported only because
 * `useFeedbackQueueItemState` needs a selector hook into the same store
 * instance. */
export const useFeedbackQueueStore = create<FeedbackQueueState>()(
  persist(
    (set) => ({
      items: [],
      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),
      _addItem: (item) => set((state) => ({ items: [...state.items, item] })),
      _patchItem: (feedbackId, patch) =>
        set((state) => ({
          items: state.items.map((entry) =>
            entry.submission.feedbackId === feedbackId ? { ...entry, ...patch } : entry,
          ),
        })),
      _patchPhotoState: (feedbackId, photoId, photoState) =>
        set((state) => ({
          items: state.items.map((entry) =>
            entry.submission.feedbackId === feedbackId
              ? {
                  ...entry,
                  photoStates: { ...entry.photoStates, [photoId]: photoState },
                }
              : entry,
          ),
        })),
    }),
    {
      name: FEEDBACK_QUEUE_STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ items: state.items }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);

// ---------------------------------------------------------------------------
// Enqueue (public API — screens call this, never the store actions above)
// ---------------------------------------------------------------------------

export interface EnqueueFeedbackInput {
  message: string;
  contact?: string | null;
  /** LOCAL file uris only (`expo-image-picker` results), same contract the
   * pre-0021 singular `photoUri` field had. Silently truncated to
   * `FEEDBACK_PHOTO_MAX_COUNT` — a defensive backstop, the real cap is
   * enforced in `app/feedback.tsx`'s own UI before this is ever called
   * with more. */
  photoUris?: string[];
}

/**
 * Durably queues one feedback submission and kicks off a sync attempt.
 * Resolves once the submission is safely on disk — a caller can show the
 * confirmation state immediately, it never needs to wait on network I/O
 * (same "the local write IS the durable submission" contract
 * `enqueueTier1Report` documents).
 */
export async function enqueueFeedback(
  input: EnqueueFeedbackInput,
  transport: FeedbackTransport = getDefaultFeedbackTransport(),
): Promise<FeedbackSubmission> {
  const deviceId = await getDeviceId();
  const photos: FeedbackPhotoAttachment[] = (input.photoUris ?? [])
    .slice(0, FEEDBACK_PHOTO_MAX_COUNT)
    .map((uri) => ({ photoId: Crypto.randomUUID(), uri }));
  const submission: FeedbackSubmission = {
    feedbackId: Crypto.randomUUID(),
    deviceId,
    message: input.message,
    contact: input.contact ?? null,
    context: buildFeedbackContext(),
    photos,
    createdAt: Date.now(),
  };

  const photoStates: Record<string, FeedbackPhotoUploadState> = {};
  for (const photo of photos) {
    photoStates[photo.photoId] = "pending-upload";
  }

  useFeedbackQueueStore.getState()._addItem({
    submission,
    state: "queued",
    attempts: 0,
    lastAttemptAt: null,
    nextRetryAt: null,
    photoStates,
  });

  // Fire-and-forget: the durable write already happened above.
  void processFeedbackQueue(transport);

  return submission;
}

// ---------------------------------------------------------------------------
// Processing (retry/backoff)
// ---------------------------------------------------------------------------

let isProcessing = false;
/** Same re-entrancy/"more work arrived mid-pass" guard as
 * `src/features/felt/queue.ts`'s own `rerunRequested` — see that file's doc
 * for the exact race (fire-and-forget enqueue racing an in-flight pass) this
 * prevents. */
let rerunRequested = false;

/**
 * Attempts to submit every eligible queued item once (looping until no new
 * work arrived during the pass), then runs a separate screenshot-upload
 * pass. Re-entrancy-guarded so overlapping triggers never double-attempt
 * the same item. Safe to call as often as needed.
 */
export async function processFeedbackQueue(
  transport: FeedbackTransport = getDefaultFeedbackTransport(),
): Promise<void> {
  if (isProcessing) {
    rerunRequested = true;
    return;
  }
  isProcessing = true;

  try {
    do {
      rerunRequested = false;

      const now = Date.now();
      const { items, _patchItem } = useFeedbackQueueStore.getState();
      const eligible = items.filter(
        (item) =>
          item.state === "queued" ||
          (item.state === "failed" &&
            (item.nextRetryAt === null || item.nextRetryAt <= now)),
      );

      for (const item of eligible) {
        const feedbackId = item.submission.feedbackId;
        _patchItem(feedbackId, { state: "syncing", lastAttemptAt: Date.now() });

        try {
          const result = await transport.submit(item.submission);

          if (result.outcome === "submitted") {
            _patchItem(feedbackId, { state: "submitted", nextRetryAt: null });
          } else if (result.outcome === "awaiting-backend") {
            _patchItem(feedbackId, { state: "awaiting-backend", nextRetryAt: null });
          } else {
            const attempts = item.attempts + 1;
            _patchItem(feedbackId, {
              state: "failed",
              attempts,
              nextRetryAt: result.retryable
                ? Date.now() + computeBackoffMs(attempts)
                : null,
            });
          }
        } catch {
          // The transport threw instead of returning a typed result —
          // treated as a retryable failure, same "no silent catches"
          // discipline as the felt queue.
          const attempts = item.attempts + 1;
          _patchItem(feedbackId, {
            state: "failed",
            attempts,
            nextRetryAt: Date.now() + computeBackoffMs(attempts),
          });
        }
      }

      // Screenshot uploads — a SEPARATE pass, re-read fresh from the store
      // (see `src/features/felt/queue.ts`'s own doc on why: an item
      // submitted for the first time in the loop just above must be picked
      // up for its photo upload in this SAME pass). Gated on
      // `state === "submitted"` because `feedback_photos.feedback_id`'s
      // foreign key needs the `feedback` row to already exist server-side.
      // Flattened to one (submission, photo) pair PER PHOTO — not per
      // item — so a submission with several photos uploads and retries
      // each one completely independently: one photo's persistent failure
      // must never block or retry-starve its siblings.
      if (typeof transport.uploadPhoto === "function") {
        const uploadPhoto = transport.uploadPhoto;
        const { items: itemsAfterSubmit, _patchPhotoState } = useFeedbackQueueStore.getState();
        const photoEligible: { submission: FeedbackSubmission; photo: FeedbackPhotoAttachment }[] =
          [];
        for (const item of itemsAfterSubmit) {
          if (item.state !== "submitted") {
            continue;
          }
          for (const photo of item.submission.photos) {
            const photoState = item.photoStates[photo.photoId];
            if (photoState === "pending-upload" || photoState === "failed") {
              photoEligible.push({ submission: item.submission, photo });
            }
          }
        }

        for (const { submission: photoSubmission, photo } of photoEligible) {
          try {
            const result = await uploadPhoto(photoSubmission, photo);
            _patchPhotoState(
              photoSubmission.feedbackId,
              photo.photoId,
              result.outcome === "uploaded" ? "uploaded" : "failed",
            );
          } catch {
            // One photo's own upload throwing must never affect any
            // sibling photo (still queued for this same pass) or the
            // surrounding message's already-"submitted" state.
            _patchPhotoState(photoSubmission.feedbackId, photo.photoId, "failed");
          }
        }
      }
    } while (rerunRequested);
  } finally {
    isProcessing = false;
  }
}

let appStateListenerAttached = false;

/**
 * Wires the app-foreground sync trigger — mirrors
 * `ensureFeltQueueForegroundSync`'s own doc (no NetInfo dependency; an
 * immediate attempt on enqueue plus every foreground transition covers
 * connectivity-regain without any background timer, PROJECT.md: "no
 * aggressive background polling"). Call once from the root layout.
 * Idempotent — safe to call on every render.
 */
export function ensureFeedbackQueueForegroundSync(
  transport: FeedbackTransport = getDefaultFeedbackTransport(),
): void {
  if (appStateListenerAttached) {
    return;
  }
  appStateListenerAttached = true;
  AppState.addEventListener("change", (status: AppStateStatus) => {
    if (status === "active") {
      void processFeedbackQueue(transport);
    }
  });
}

// ---------------------------------------------------------------------------
// Read-only selectors for screens
// ---------------------------------------------------------------------------

/** Reactive lookup of one submission's current queue state — drives the
 * Feedback screen's confirmation copy (submitted vs. queued-locally),
 * mirroring `useQueueItemState`. */
export function useFeedbackQueueItemState(
  feedbackId: string | null,
): FeedbackQueueItemState | null {
  return useFeedbackQueueStore((state) =>
    feedbackId
      ? (state.items.find((item) => item.submission.feedbackId === feedbackId)?.state ?? null)
      : null,
  );
}

/** True once the persisted queue has been read back from AsyncStorage —
 * mirrors `useFeltQueueHasHydrated`'s own "don't flash empty before
 * hydration" gate. */
export function useFeedbackQueueHasHydrated(): boolean {
  return useFeedbackQueueStore((state) => state.hasHydrated);
}
