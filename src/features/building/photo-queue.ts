import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { AppState, Platform, type AppStateStatus } from "react-native";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { HOME_PHOTO_MAX_COUNT, PHOTO_CAPTION_MAX } from "./constants";
import {
  photoContentType,
  photoFileName,
  readHomePhoto,
  type DraftPhoto,
  type StoredPhotoSlot,
} from "./photos";
import { SupabaseHomeTransport, type HomeTransport } from "./transport";
import { HomeError } from "./types";

/**
 * Upload queue for the photos of a tagged home. Same idea as the felt-report
 * photo queue: a photo is written to the on-device queue first, and uploads
 * happen afterwards, so a weak network never loses a photo or blocks the
 * report. There is no background timer (battery): the queue is drained right
 * after a home is saved, at app start and on every return to the foreground,
 * and a failed photo backs off before it is tried again.
 *
 * Storage detail: on native a queued item holds a `file://` uri (small). On
 * web a picked photo is a self-contained `data:` uri of several hundred KB,
 * which would overflow the ~5 MB localStorage quota if persisted, so web
 * keeps those in memory only (they upload while the tab is open).
 */

export interface QueuedPhoto {
  id: string;
  tagId: string;
  uri: string;
  slot: StoredPhotoSlot;
  caption: string;
  /** Fixed at enqueue time so a retry after a lost response reuses the file. */
  fileName: string;
  createdAt: number;
  /** Failed tries that were not plain network trouble. */
  failures: number;
  /** Tries of any kind, for the back-off. */
  attempts: number;
  nextRetryAt: number | null;
}

const QUEUE_STORAGE_KEY = "bumelerze.home.photoQueue";
const INITIAL_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 10 * 60_000;
/** A photo that fails this many times for a reason other than the network
 * (refused by the server, unreadable file) is dropped. */
const MAX_HARD_FAILURES = 5;

function backoffMs(attempts: number): number {
  return Math.min(INITIAL_BACKOFF_MS * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);
}

interface PhotoQueueState {
  items: QueuedPhoto[];
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
  _add: (items: QueuedPhoto[]) => void;
  _patch: (id: string, patch: Partial<QueuedPhoto>) => void;
  _remove: (id: string) => void;
  _clear: () => void;
}

export const useHomePhotoQueueStore = create<PhotoQueueState>()(
  persist(
    (set) => ({
      items: [],
      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),
      _add: (items) => set((state) => ({ items: [...state.items, ...items] })),
      _patch: (id, patch) =>
        set((state) => ({
          items: state.items.map((item) =>
            item.id === id ? { ...item, ...patch } : item,
          ),
        })),
      _remove: (id) =>
        set((state) => ({ items: state.items.filter((i) => i.id !== id) })),
      _clear: () => set({ items: [] }),
    }),
    {
      name: QUEUE_STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        items:
          Platform.OS === "web"
            ? state.items.filter((item) => !item.uri.startsWith("data:"))
            : state.items,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);

/** Queues the picked photos of a saved home. Over the per-home cap the extras
 * are dropped (the flow already stops at the cap; this is the last guard). */
export function enqueueHomePhotos(tagId: string, photos: readonly DraftPhoto[]): number {
  const store = useHomePhotoQueueStore.getState();
  const queuedForTag = store.items.filter((item) => item.tagId === tagId).length;
  const room = Math.max(0, HOME_PHOTO_MAX_COUNT - queuedForTag);
  const stamp = Date.now();
  const items = photos.slice(0, room).map((photo, index): QueuedPhoto => {
    const id = Crypto.randomUUID();
    return {
      id,
      tagId,
      uri: photo.uri,
      slot: photo.slot,
      caption: photo.slot === "more" ? photo.caption.slice(0, PHOTO_CAPTION_MAX) : "",
      fileName: photoFileName(photo.slot, stamp + index, id.slice(0, 6)),
      createdAt: stamp + index,
      failures: 0,
      attempts: 0,
      nextRetryAt: null,
    };
  });
  if (items.length > 0) {
    store._add(items);
  }
  return items.length;
}

let isProcessing = false;

export interface ProcessOptions {
  transport?: HomeTransport;
  /** Try every queued photo now, ignoring the back-off (a foreground or
   * just-saved trigger). */
  ignoreBackoff?: boolean;
  now?: number;
}

function isNetworkTrouble(error: unknown): boolean {
  return (
    error instanceof HomeError &&
    (error.code === "network" ||
      error.code === "unconfigured" ||
      error.code === "need_account")
  );
}

/**
 * Uploads what is due, one photo at a time. Never throws: a photo that
 * fails stays queued with a back-off (network trouble or no account yet: forever;
 * anything else up to 5 times). Returns how many photos were uploaded.
 */
export async function processHomePhotoQueue(
  options: ProcessOptions = {},
): Promise<number> {
  if (isProcessing) {
    return 0;
  }
  isProcessing = true;
  const transport = options.transport ?? SupabaseHomeTransport;
  const now = options.now ?? Date.now();
  let uploaded = 0;
  try {
    const due = useHomePhotoQueueStore
      .getState()
      .items.filter(
        (item) =>
          options.ignoreBackoff === true ||
          item.nextRetryAt === null ||
          item.nextRetryAt <= now,
      );
    for (const item of due) {
      const store = useHomePhotoQueueStore.getState();
      try {
        const body = await readHomePhoto(item.uri);
        await transport.uploadPhoto({
          tagId: item.tagId,
          fileName: item.fileName,
          body,
          contentType: photoContentType(item.uri),
        });
        try {
          await transport.savePhotoMeta({
            tagId: item.tagId,
            fileName: item.fileName,
            slot: item.slot,
            caption: item.caption,
          });
        } catch {
          // The photo is stored and shows by its file name; only the caption
          // is lost (the table arrives with migration 0042).
        }
        store._remove(item.id);
        uploaded += 1;
      } catch (error) {
        const network = isNetworkTrouble(error);
        const tooLarge = error instanceof HomeError && error.code === "photo_too_large";
        const failures = network ? item.failures : item.failures + 1;
        if (tooLarge || failures >= MAX_HARD_FAILURES) {
          store._remove(item.id);
        } else {
          const attempts = item.attempts + 1;
          store._patch(item.id, {
            attempts,
            failures,
            nextRetryAt: Date.now() + backoffMs(attempts),
          });
        }
      }
    }
  } finally {
    isProcessing = false;
  }
  return uploaded;
}

let appStateListenerAttached = false;

/** Wires the foreground trigger once from the root layout (no NetInfo, no
 * timers: an attempt at start-up and on every return to the foreground). */
export function ensureHomePhotoQueueForegroundSync(): void {
  if (appStateListenerAttached) {
    return;
  }
  appStateListenerAttached = true;
  AppState.addEventListener("change", (status: AppStateStatus) => {
    if (status === "active") {
      void processHomePhotoQueue({ ignoreBackoff: true });
    }
  });
}

/** How many photos of one home are still waiting to upload. */
export function useQueuedPhotoCount(tagId: string | undefined): number {
  return useHomePhotoQueueStore((state) =>
    tagId ? state.items.filter((item) => item.tagId === tagId).length : 0,
  );
}
