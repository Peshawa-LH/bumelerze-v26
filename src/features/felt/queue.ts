import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { AppState, type AppStateStatus } from "react-native";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { isSupabaseConfigured } from "@/lib/supabase";

import { getDeviceId } from "./device-id";
// A real (value) import, not `import type` — this IS the transport we want
// to select at runtime below. Safe from a circular-dependency standpoint:
// `supabase-transport.ts` only imports FeltTransport/TransportResult FROM
// this file as `import type`, which TypeScript erases entirely at compile
// time, so there is no actual runtime `require()` cycle between the two
// modules — only this file has a real value-level edge to the other.
import { SupabaseTransport } from "./supabase-transport";
import type {
  CartoonLevel,
  EventRegistration,
  FeltLocation,
  Tier1Report,
  Tier2Answers,
  Tier2Report,
} from "./types";

/**
 * Offline-first felt-report submission queue (spec-v1.md §4.6 states;
 * PROJECT.md offline requirement; felt-report-science-v1.md acceptance
 * criterion — "no report is ever lost"). Every tier-1/tier-2 submission is
 * written to AsyncStorage (via zustand's `persist` middleware) BEFORE any
 * network attempt is made: the local write IS the durable "submission" from
 * the user's point of view. `processQueue` below only ever tries to move an
 * already-safe local record onto a server when one exists — a failed or
 * slow network attempt can never lose data that's already on disk.
 *
 * zustand (not a plain module) so the tier-1 confirmation screen (and any
 * future "N reports queued" indicator) can subscribe reactively to queue
 * state — the same pattern this codebase already uses for onboarding prefs
 * (`features/onboarding/store.ts`). A plain module would need a hand-rolled
 * subscriber list to get the same reactivity for free.
 *
 * No NetInfo dependency (matches `features/events/queries.ts`'s own
 * documented choice): connectivity-regain is covered by (a) attempting a
 * sync immediately after every enqueue — the common "just got signal back
 * and immediately reports" case — and (b) re-attempting on every
 * app-foreground transition (`ensureFeltQueueForegroundSync`). Failed
 * attempts additionally back off and retry on the next such trigger, so a
 * device that's offline for hours still catches up the moment it's
 * foregrounded with connectivity, without any timer running while
 * backgrounded (PROJECT.md: "no aggressive background polling... no
 * wake-lock abuse").
 */

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export type TransportResult =
  | { outcome: "submitted"; serverReportId: string }
  /** No backend exists to hand off to yet (this wave) — NOT a failure:
   * nothing was attempted, nothing was lost, nothing needs retrying until a
   * real transport replaces `PendingTransport`. */
  | { outcome: "awaiting-backend" }
  | { outcome: "failed"; retryable: boolean };

export interface FeltTransport {
  submitTier1(report: Tier1Report): Promise<TransportResult>;
  /** Tier-2 submission supersedes the device's tier-1 pick (D18 §3.2) — a
   * real transport's implementation inserts/updates both `felt_reports` and
   * `felt_report_details` from this one call; the queue only tracks it as a
   * single item either way (see `QueueItem`). */
  submitTier2(report: Tier2Report): Promise<TransportResult>;
}

/**
 * The fallback transport for whenever no Supabase project is configured yet
 * (`isSupabaseConfigured()` false — PROJECT.md "Blocked on Peshawa: Supabase
 * project"). Every report simply stays queued locally, forever, in the
 * "awaiting-backend" state until `getDefaultFeltTransport()` below starts
 * picking `SupabaseTransport` instead (the moment the owner pastes the two
 * env values in, per `supabase/README.md`'s "Wiring status" section — no
 * code change needed).
 */
export const PendingTransport: FeltTransport = {
  submitTier1: () => Promise.resolve({ outcome: "awaiting-backend" }),
  submitTier2: () => Promise.resolve({ outcome: "awaiting-backend" }),
};

/**
 * Resolves the transport every exported queue function below defaults to
 * when a caller doesn't pass one explicitly: `SupabaseTransport` once a
 * project is configured, `PendingTransport` otherwise (today's behavior,
 * unchanged). A function (not a module-load-time constant) so it re-checks
 * `isSupabaseConfigured()` on every call — env vars are static within one
 * running app, but tests toggle `process.env` between cases without a full
 * `jest.resetModules()` remount for every scenario.
 */
export function getDefaultFeltTransport(): FeltTransport {
  return isSupabaseConfigured() ? SupabaseTransport : PendingTransport;
}

// ---------------------------------------------------------------------------
// Queue store
// ---------------------------------------------------------------------------

export type QueueItemState =
  | "queued" // written locally, not yet attempted (or needs a re-attempt)
  | "syncing" // an attempt is in flight right now
  | "awaiting-backend" // reached the transport layer; see PendingTransport
  | "submitted" // a real transport confirmed server receipt
  | "failed"; // the transport reported a retryable (or terminal) failure

export interface QueueItem {
  tier1: Tier1Report;
  /** Attached once the user completes tier 2 (D18 §3.2 supersede-in-place —
   * this is still ONE queue item, never a second one). */
  tier2: Tier2Report | null;
  state: QueueItemState;
  attempts: number;
  lastAttemptAt: number | null;
  nextRetryAt: number | null;
}

const QUEUE_STORAGE_KEY = "bumelerze.felt.queue";
const INITIAL_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 10 * 60_000;

function computeBackoffMs(attempts: number): number {
  return Math.min(INITIAL_BACKOFF_MS * 2 ** attempts, MAX_BACKOFF_MS);
}

interface FeltQueueState {
  items: QueueItem[];
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
  _addItem: (item: QueueItem) => void;
  _patchItem: (reportId: string, patch: Partial<QueueItem>) => void;
  _attachTier2: (reportId: string, tier2: Tier2Report) => void;
}

/** Internal — screens/hooks should go through the exported functions below,
 * not call store actions (prefixed `_`) directly, so every mutation stays
 * paired with the durability/queueing comments above. Exported only because
 * `useQueueItemState` needs a selector hook into the same store instance. */
export const useFeltQueueStore = create<FeltQueueState>()(
  persist(
    (set) => ({
      items: [],
      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),
      _addItem: (item) => set((state) => ({ items: [...state.items, item] })),
      _patchItem: (reportId, patch) =>
        set((state) => ({
          items: state.items.map((entry) =>
            entry.tier1.reportId === reportId ? { ...entry, ...patch } : entry,
          ),
        })),
      _attachTier2: (reportId, tier2) =>
        set((state) => ({
          items: state.items.map((entry) =>
            entry.tier1.reportId === reportId
              ? { ...entry, tier2, state: "queued", attempts: 0, nextRetryAt: null }
              : entry,
          ),
        })),
    }),
    {
      name: QUEUE_STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ items: state.items }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);

// ---------------------------------------------------------------------------
// Enqueue (public API — screens call these, never the store actions above)
// ---------------------------------------------------------------------------

export interface EnqueueTier1Input {
  cartoonLevel: CartoonLevel;
  location: FeltLocation;
  /** Null when unassociated (Home pill, no recent regional event —
   * `association.ts`); a specific event id from Event Detail's pill. */
  eventId: string | null;
  /** The event snapshot `SupabaseTransport` resolves to a canonical server
   * uuid at submit time (`toEventRegistration`, migration 0011). Optional
   * for backward compatibility with existing callers/tests that only pass
   * `eventId` — omitted/undefined is stored as `null`, same "no event
   * context to register" meaning either way. */
  eventRegistration?: EventRegistration | null;
}

/**
 * The panic-time one-tap action (spec-v1.md §4.6: "one tap selects AND
 * submits"). Resolves once the report is durably queued — a caller can
 * immediately show the confirmation state, it never needs to wait on
 * network I/O.
 */
export async function enqueueTier1Report(
  input: EnqueueTier1Input,
  transport: FeltTransport = getDefaultFeltTransport(),
): Promise<Tier1Report> {
  const deviceId = await getDeviceId();
  const now = Date.now();
  const tier1: Tier1Report = {
    reportId: Crypto.randomUUID(),
    deviceId,
    eventId: input.eventId,
    eventRegistration: input.eventRegistration ?? null,
    cartoonLevel: input.cartoonLevel,
    location: input.location,
    feltAt: now,
    createdAt: now,
    submittedAt: null,
  };

  useFeltQueueStore.getState()._addItem({
    tier1,
    tier2: null,
    state: "queued",
    attempts: 0,
    lastAttemptAt: null,
    nextRetryAt: null,
  });

  // Fire-and-forget: the durable write already happened above. A failure or
  // slow network here only affects how soon the item leaves "queued" state,
  // never whether the report exists.
  void processQueue(transport);

  return tier1;
}

export interface EnqueueTier2Input {
  feltReportId: string;
  answers: Tier2Answers;
  /** Window 3's optional photo attachment (2026-08-15 flow restructure) —
   * see `Tier2Report.photoUri`'s own doc. Omitted/undefined is stored as
   * `null`, same "no photo" meaning either way. */
  photoUri?: string | null;
}

/**
 * Post-tier-1 follow-up — covers both the baseline windows 2/3 upgrade
 * (damage/comment/photo only, most `answers` fields still null) and the
 * full "add more detail" questionnaire completion; both attach to
 * (supersede) the existing queue item for `feltReportId` via the same
 * mechanism (2026-08-15 flow restructure, owner directive: "supersede
 * semantics like tier-2 today"). Throws if that item doesn't exist, which
 * would only happen from a programming error (this flow is only ever
 * reachable with a real tier-1 report id in hand, per the wave brief's
 * navigation rule).
 */
export async function enqueueTier2Report(
  input: EnqueueTier2Input,
  transport: FeltTransport = getDefaultFeltTransport(),
): Promise<Tier2Report> {
  const tier1Item = useFeltQueueStore
    .getState()
    .items.find((item) => item.tier1.reportId === input.feltReportId);
  if (!tier1Item) {
    throw new Error(
      `enqueueTier2Report: no queued tier-1 report with id "${input.feltReportId}"`,
    );
  }

  const tier2: Tier2Report = {
    detailId: Crypto.randomUUID(),
    feltReportId: input.feltReportId,
    // Copied from the tier-1 record, not re-collected — felt_comments needs
    // its own device_id (2026-08-16 comment-upload-gap fix); see
    // Tier2Report.deviceId's own doc.
    deviceId: tier1Item.tier1.deviceId,
    answers: input.answers,
    photoUri: input.photoUri ?? null,
    createdAt: Date.now(),
  };

  useFeltQueueStore.getState()._attachTier2(input.feltReportId, tier2);
  void processQueue(transport);

  return tier2;
}

// ---------------------------------------------------------------------------
// Processing (retry/backoff)
// ---------------------------------------------------------------------------

let isProcessing = false;
/**
 * Set when `processQueue` is called again WHILE a pass is already running
 * (e.g. enqueueTier1Report's fire-and-forget call racing the cold-start
 * `void processQueue()` in `app/_layout.tsx`'s own initial drain, or a
 * quick tier1 -> tier2 upgrade racing the tier1 submission's own in-flight
 * network call). The in-flight pass below snapshots `eligible` from the
 * store ONCE at its start — without this flag, an item that becomes
 * eligible strictly during that pass (added by the very call this flag
 * records) would sit in "queued" state with nothing left to trigger it:
 * the racing call already returned (no-op, `isProcessing` was true) and
 * the running pass's own snapshot never included it. The only remaining
 * triggers are the next enqueue or the next app-foreground transition —
 * on web specifically, a tab that never loses focus may never fire that
 * second trigger, so a report submitted into this race window could sit
 * un-synced indefinitely even with a healthy network connection (the
 * "newest report never appeared" symptom this fixes). The fix: instead of
 * dropping the racing call, remember that more work arrived, and have the
 * in-flight pass loop again before releasing the lock.
 */
let rerunRequested = false;

/**
 * Attempts to submit every eligible queued item once (looping until no new
 * work arrived during the pass — see `rerunRequested`'s own doc for why a
 * single pass isn't enough). Re-entrancy-guarded so overlapping triggers
 * (enqueue + foreground event arriving together, for example) never
 * double-attempt the same item or double-count `attempts`; a trigger that
 * arrives while a pass is already running is queued as a rerun instead of
 * silently dropped. Safe to call as often as needed — it's a fast no-op
 * pass when nothing is eligible.
 */
export async function processQueue(
  transport: FeltTransport = getDefaultFeltTransport(),
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
      const { items, _patchItem } = useFeltQueueStore.getState();
      const eligible = items.filter(
        (item) =>
          item.state === "queued" ||
          (item.state === "failed" &&
            (item.nextRetryAt === null || item.nextRetryAt <= now)),
      );

      for (const item of eligible) {
        const reportId = item.tier1.reportId;
        _patchItem(reportId, { state: "syncing", lastAttemptAt: Date.now() });

        try {
          const result = item.tier2
            ? await transport.submitTier2(item.tier2)
            : await transport.submitTier1(item.tier1);

          if (result.outcome === "submitted") {
            _patchItem(reportId, {
              state: "submitted",
              tier1: { ...item.tier1, submittedAt: Date.now() },
              nextRetryAt: null,
            });
          } else if (result.outcome === "awaiting-backend") {
            _patchItem(reportId, { state: "awaiting-backend", nextRetryAt: null });
          } else {
            const attempts = item.attempts + 1;
            _patchItem(reportId, {
              state: "failed",
              attempts,
              nextRetryAt: result.retryable
                ? Date.now() + computeBackoffMs(attempts)
                : null,
            });
          }
        } catch {
          // The transport threw instead of returning a typed result — treated
          // as a retryable failure. This IS the error handling (PROJECT.md:
          // "no silent catches"): the item visibly moves to "failed" with a
          // scheduled retry rather than the error disappearing.
          const attempts = item.attempts + 1;
          _patchItem(reportId, {
            state: "failed",
            attempts,
            nextRetryAt: Date.now() + computeBackoffMs(attempts),
          });
        }
      }
    } while (rerunRequested);
  } finally {
    isProcessing = false;
  }
}

let appStateListenerAttached = false;

/**
 * Wires the app-foreground sync trigger (spec-v1.md §4.6: "queues locally
 * and syncs — PROJECT.md offline requirement"). Call once from the root
 * layout, same lifecycle as `features/events/queries.ts`'s own AppState
 * wiring. Idempotent — safe to call on every render.
 */
export function ensureFeltQueueForegroundSync(
  transport: FeltTransport = getDefaultFeltTransport(),
): void {
  if (appStateListenerAttached) {
    return;
  }
  appStateListenerAttached = true;
  AppState.addEventListener("change", (status: AppStateStatus) => {
    if (status === "active") {
      void processQueue(transport);
    }
  });
}

// ---------------------------------------------------------------------------
// Read-only selectors for screens
// ---------------------------------------------------------------------------

/** Reactive lookup of one report's current queue state — drives the tier-1
 * confirmation screen's "queued/offline" indicator. */
export function useQueueItemState(reportId: string | null): QueueItemState | null {
  return useFeltQueueStore((state) =>
    reportId
      ? (state.items.find((item) => item.tier1.reportId === reportId)?.state ?? null)
      : null,
  );
}

/** The device's own queued report for a given event, if any — powers Event
 * Detail's "your report / add more detail" row (wave brief point 4). Only
 * ever finds LOCAL queue items (this device's own submissions), never a
 * server-side felt-map lookup — there is no backend to query yet. */
export function useOwnQueueItemForEvent(eventId: string | null): QueueItem | null {
  return useFeltQueueStore((state) =>
    eventId ? (state.items.find((item) => item.tier1.eventId === eventId) ?? null) : null,
  );
}
