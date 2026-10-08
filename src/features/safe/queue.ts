import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { AppState, type AppStateStatus } from "react-native";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { EventRegistration } from "@/features/felt";

import { LOCAL_RETENTION_MS } from "./constants";
import type { PromptMemory } from "./relevance";
import {
  SupabaseCheckInTransport,
  type CheckInFailure,
  type CheckInTransport,
} from "./transport";

/**
 * Local-first "I'm safe" queue, a small sibling of the felt-report queue
 * (`features/felt/queue.ts`, same promise: the tap is saved on the phone
 * BEFORE any network call, and nothing is lost offline). Persisted with
 * zustand + AsyncStorage; drained right after a tap and on every app
 * foreground, with doubling backoff (5 s to 10 min) after a failure.
 *
 * What is stored on the phone: a random client id, the earthquake's public
 * identity (provider id, origin time, magnitude, epicentre, place name), the
 * time of the tap and the sending state. Never the phone's own position.
 *
 * Undo: an item never attempted is simply dropped. Once an attempt may have
 * reached the server, Undo sends `retract_checkin`, which also leaves a
 * tombstone on the server, so a check-in still in flight cannot come back.
 */

export type CheckInState =
  | "queued" // saved on the phone, not sent yet (or waiting for a retry)
  | "syncing" // an attempt is in flight
  | "sent" // the server confirmed: the family can see it
  | "failed"; // stopped: see `failure` (retried later when `nextRetryAt` is set)

export interface CheckInItem {
  clientId: string;
  /** `provider:providerId` of the earthquake. */
  eventKey: string;
  event: EventRegistration;
  /** The server's event id once resolved. */
  serverEventId: string | null;
  checkedInAt: number;
  state: CheckInState;
  attempts: number;
  nextRetryAt: number | null;
  failure: CheckInFailure | null;
  /** Undo was tapped; the item goes once the server agrees (or at once when
   * it never left the phone). */
  undone: boolean;
}

const STORAGE_KEY = "bumelerze.safe.checkins";
const INITIAL_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 10 * 60_000;
const HANDLED_MEMORY_MS = 7 * 24 * 60 * 60_000;

function backoffMs(attempts: number): number {
  return Math.min(INITIAL_BACKOFF_MS * 2 ** attempts, MAX_BACKOFF_MS);
}

interface CheckInStoreState extends PromptMemory {
  items: CheckInItem[];
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
  _add: (item: CheckInItem) => void;
  _patch: (clientId: string, patch: Partial<CheckInItem>) => void;
  _remove: (clientId: string) => void;
  _handle: (eventKey: string, magnitude: number, at: number) => void;
  _prune: (now: number) => void;
}

export const useCheckInStore = create<CheckInStoreState>()(
  persist(
    (set) => ({
      items: [],
      handled: {},
      lastAction: null,
      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),
      _add: (item) => set((s) => ({ items: [...s.items, item] })),
      _patch: (clientId, patch) =>
        set((s) => ({
          items: s.items.map((item) =>
            item.clientId === clientId ? { ...item, ...patch } : item,
          ),
        })),
      _remove: (clientId) =>
        set((s) => ({ items: s.items.filter((item) => item.clientId !== clientId) })),
      _handle: (key, magnitude, at) =>
        set((s) => ({
          handled: { ...s.handled, [key]: at },
          lastAction: { at, magnitude },
        })),
      _prune: (now) =>
        set((s) => ({
          items: s.items.filter(
            (item) =>
              !(item.state === "sent" && now - item.checkedInAt > LOCAL_RETENTION_MS),
          ),
          handled: Object.fromEntries(
            Object.entries(s.handled).filter(([, at]) => now - at < HANDLED_MEMORY_MS),
          ),
        })),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        items: s.items,
        handled: s.handled,
        lastAction: s.lastAction,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);

/** "Not now" (or a check-in) answers the prompt for this event; the 3-hour
 * quiet period starts. */
export function markPromptHandled(
  key: string,
  magnitude: number,
  now: number = Date.now(),
): void {
  useCheckInStore.getState()._handle(key, magnitude, now);
}

export interface EnqueueCheckInInput {
  eventKey: string;
  event: EventRegistration;
}

/** The one-tap action. Resolves once the check-in is saved on the phone; the
 * send happens in the background. */
export function enqueueCheckIn(
  input: EnqueueCheckInInput,
  transport: CheckInTransport = SupabaseCheckInTransport,
  now: number = Date.now(),
): CheckInItem {
  const item: CheckInItem = {
    clientId: Crypto.randomUUID(),
    eventKey: input.eventKey,
    event: input.event,
    serverEventId: null,
    checkedInAt: now,
    state: "queued",
    attempts: 0,
    nextRetryAt: null,
    failure: null,
    undone: false,
  };
  const store = useCheckInStore.getState();
  store._add(item);
  store._handle(input.eventKey, input.event.magnitude, now);
  void processCheckInQueue(transport);
  return item;
}

/** Undo. Drops an item that never left the phone; otherwise asks the server
 * to take it back (retried like a check-in until it succeeds). */
export function undoCheckIn(
  clientId: string,
  transport: CheckInTransport = SupabaseCheckInTransport,
): void {
  const store = useCheckInStore.getState();
  const item = store.items.find((entry) => entry.clientId === clientId);
  if (!item) return;
  if (item.attempts === 0 && item.state === "queued") {
    store._remove(clientId);
    return;
  }
  store._patch(clientId, { undone: true, nextRetryAt: null });
  void processCheckInQueue(transport);
}

let isProcessing = false;
let rerunRequested = false;

function eligible(item: CheckInItem, now: number): boolean {
  if (item.state === "syncing") return false;
  if (item.undone) return item.nextRetryAt === null || item.nextRetryAt <= now;
  if (item.state === "queued")
    return item.nextRetryAt === null || item.nextRetryAt <= now;
  return item.state === "failed" && item.nextRetryAt !== null && item.nextRetryAt <= now;
}

async function sendOne(item: CheckInItem, transport: CheckInTransport): Promise<void> {
  const { _patch, _remove } = useCheckInStore.getState();
  const id = item.clientId;

  if (item.undone) {
    const done = await transport.retract(id).catch(() => false);
    if (done) {
      _remove(id);
    } else {
      const attempts = item.attempts + 1;
      _patch(id, { attempts, nextRetryAt: Date.now() + backoffMs(attempts) });
    }
    return;
  }

  _patch(id, { state: "syncing" });
  const fail = (retryable: boolean, reason: CheckInFailure) => {
    const attempts = item.attempts + 1;
    _patch(id, {
      state: retryable ? "queued" : "failed",
      attempts,
      failure: reason,
      nextRetryAt: retryable ? Date.now() + backoffMs(attempts) : null,
    });
  };

  try {
    const eventId = item.serverEventId ?? (await transport.resolveEvent(item.event));
    if (!eventId) {
      fail(true, "network");
      return;
    }
    if (eventId !== item.serverEventId) {
      _patch(id, { serverEventId: eventId });
    }
    const result = await transport.checkIn({
      clientId: id,
      eventId,
      checkedInAt: item.checkedInAt,
    });
    if (result.outcome === "sent") {
      _patch(id, {
        state: "sent",
        attempts: item.attempts + 1,
        failure: null,
        nextRetryAt: null,
      });
    } else if (result.outcome === "retracted") {
      _remove(id);
    } else {
      fail(result.retryable, result.reason);
    }
  } catch {
    fail(true, "network");
  }
}

/** Sends everything that is due, once. Safe to call as often as wanted. */
export async function processCheckInQueue(
  transport: CheckInTransport = SupabaseCheckInTransport,
): Promise<void> {
  if (isProcessing) {
    rerunRequested = true;
    return;
  }
  isProcessing = true;
  try {
    useCheckInStore.getState()._prune(Date.now());
    do {
      rerunRequested = false;
      const now = Date.now();
      const due = useCheckInStore.getState().items.filter((item) => eligible(item, now));
      for (const item of due) {
        // Re-read: Undo may have been tapped since the snapshot.
        const fresh = useCheckInStore
          .getState()
          .items.find((entry) => entry.clientId === item.clientId);
        if (fresh) await sendOne(fresh, transport);
      }
      // An Undo tapped while its check-in was in flight: retract now.
      const pendingUndo = useCheckInStore
        .getState()
        .items.some(
          (item) => item.undone && item.state !== "syncing" && eligible(item, Date.now()),
        );
      if (pendingUndo) rerunRequested = true;
    } while (rerunRequested);
  } finally {
    isProcessing = false;
  }
}

let foregroundAttached = false;

/** Retry on every app foreground. Call once from the root layout. */
export function ensureCheckInForegroundSync(
  transport: CheckInTransport = SupabaseCheckInTransport,
): void {
  if (foregroundAttached) return;
  foregroundAttached = true;
  AppState.addEventListener("change", (status: AppStateStatus) => {
    if (status === "active") {
      void processCheckInQueue(transport);
    }
  });
}

/** Live state of one check-in (null once undone or forgotten). */
export function useCheckInItem(clientId: string | null): CheckInItem | null {
  return useCheckInStore((s) =>
    clientId ? (s.items.find((item) => item.clientId === clientId) ?? null) : null,
  );
}

/** The phone's latest live check-in for an event, if any. */
export function useCheckInForEvent(key: string | null): CheckInItem | null {
  return useCheckInStore((s) => {
    if (!key) return null;
    let latest: CheckInItem | null = null;
    for (const item of s.items) {
      if (
        item.eventKey === key &&
        !item.undone &&
        (!latest || item.checkedInAt > latest.checkedInAt)
      ) {
        latest = item;
      }
    }
    return latest;
  });
}

/** Test helper: forget the processing lock between tests. */
export function __resetCheckInQueueForTests(): void {
  isProcessing = false;
  rerunRequested = false;
  useCheckInStore.setState({ items: [], handled: {}, lastAction: null });
}
