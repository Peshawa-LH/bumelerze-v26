import {
  dehydrate,
  type Query,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";

/**
 * The app's one React Query cache and its copy on the device, as the root
 * layout made them (app/_layout.tsx registers both at start). At sign-out the
 * previous person's answers leave both (security audit APP-04), while
 * public data stays, so the earthquake feed still opens with no network
 * (panic-time, offline-first).
 *
 * Kept: an ALLOW-LIST of key prefixes whose data is public and the same for
 * every user. Anything else, including a key added later and not listed
 * here, is removed: the safe default.
 */
export const PUBLIC_QUERY_KEY_PREFIXES: readonly (readonly string[])[] = [
  // Feeds (region, world, notable), one event, Bumelerze ids, possible
  // events, source corroboration (src/features/events).
  ["events"],
  // Provider id -> server event id (src/features/feltmap/event-uuid-query.ts).
  ["event-uuid"],
  // Felt-report cells of an event: anonymous aggregates.
  ["feltmap"],
  // SHAKEmap products of an event.
  ["shakemap"],
  // Station waveforms and the stations' reachability.
  ["station-trace"],
  ["station-probe"],
  // Event hub counts, towns and timeline: aggregates with no viewer in the
  // key. The hub's threads, likes, roles and permissions carry a viewer and
  // are removed.
  ["eventhub", "summary"],
  ["eventhub", "feltTowns"],
  ["eventhub", "timeline"],
];

/** True when `key` starts with one of the public prefixes. */
export function isPublicQueryKey(key: QueryKey): boolean {
  return PUBLIC_QUERY_KEY_PREFIXES.some(
    (prefix) =>
      key.length >= prefix.length && prefix.every((part, index) => key[index] === part),
  );
}

export interface SessionQueryCacheOptions {
  /** The provider's `buster`: a save with another one is thrown away on restore. */
  buster: string;
  /** The provider's `dehydrateOptions.shouldDehydrateQuery`. */
  shouldDehydrateQuery?: (query: Query) => boolean;
  /** Writes a device copy at once, bypassing the persister's throttle. Only
   * used when the throttled saves are too slow to wait for (a very busy
   * phone), so the public data is still kept. */
  saveNow?: (client: PersistedClient) => Promise<void>;
}

/** A persister that knows which of its saves have not finished yet. */
export interface TrackedPersister extends Persister {
  pendingSaves(): Promise<unknown>[];
}

/**
 * Wraps the app's persister so the sign-out clean-up can wait for its saves.
 * The async-storage persister throttles: a save asked for while another is
 * written waits, and carries the newest data when it runs; a call made
 * while one is already waiting returns at once (that waiting save will carry
 * its data). So once every save pending at some moment has finished, the
 * last one written holds the data of that moment or newer.
 */
export function trackPersisterSaves(inner: Persister): TrackedPersister {
  const pending = new Set<Promise<unknown>>();
  return {
    persistClient: (client) => {
      const save = Promise.resolve(inner.persistClient(client));
      pending.add(save);
      save.then(
        () => pending.delete(save),
        () => pending.delete(save),
      );
      return save;
    },
    restoreClient: () => inner.restoreClient(),
    removeClient: () => inner.removeClient(),
    pendingSaves: () => [...pending],
  };
}

function isTracked(persister: Persister): persister is TrackedPersister {
  return typeof (persister as Partial<TrackedPersister>).pendingSaves === "function";
}

let registered: {
  client: QueryClient;
  persister: Persister;
  options: SessionQueryCacheOptions;
} | null = null;

export function registerSessionQueryCache(
  client: QueryClient,
  persister: Persister,
  options: SessionQueryCacheOptions,
): void {
  registered = { client, persister, options };
}

/** How long a sign-out waits for the persister's own saves (throttled to one
 * a second, so normally one to two seconds). */
export const CLEAN_SAVE_WAIT_MS = 4_000;
/** Then how long it tries to confirm a clean copy before removing it. */
export const CLEAN_SAVE_CONFIRM_MS = 1_000;
const POLL_MS = 50;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolves when `work` settles or after `ms`, leaving no timer behind. */
function settledWithin(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, ms));
    void work.finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** The saved copy holds nothing of the previous session: every query in it
 * is public, or was loaded after `since` (the session had ended by then, so
 * it belongs to the guest that follows, e.g. a screen that re-rendered). */
function nothingFromBefore(saved: PersistedClient, since: number): boolean {
  return saved.clientState.queries.every(
    (query) => isPublicQueryKey(query.queryKey) || query.state.dataUpdatedAt >= since,
  );
}

/**
 * Removes every non-public query from memory, then makes sure the device copy
 * holds nothing else from before, before it resolves (the caller has ended
 * the session and starts the next guest session right after).
 *
 * 1. The cleaned cache goes to the provider's own persister, so its saves stay
 *    in order: its next save is the cleaned cache (or newer).
 * 2. Every save that was pending at that moment, an older one being written
 *    included, is waited for (`trackPersisterSaves`).
 * 3. The copy on the device is read back: it must be a save made from step 1
 *    on whose queries are all public or loaded after it. If the saves were
 *    too slow (a very busy phone), the cleaned cache is written directly
 *    (`saveNow`) and read back again.
 * 4. Still not clean: the copy is removed altogether (the public data is lost
 *    rather than private data kept).
 * Never throws.
 */
export async function clearPersonalQueries({
  waitMs = CLEAN_SAVE_WAIT_MS,
  confirmMs = CLEAN_SAVE_CONFIRM_MS,
}: { waitMs?: number; confirmMs?: number } = {}): Promise<void> {
  if (!registered) {
    return;
  }
  const { client, persister, options } = registered;
  try {
    client.removeQueries({ predicate: (query) => !isPublicQueryKey(query.queryKey) });
    // Mutations hold what was typed (a comment, a name): never needed again.
    client.getMutationCache().clear();
  } catch {
    // Carry on: the device copy below is what outlives the session.
  }

  const since = Date.now();
  try {
    const cleaned: PersistedClient = {
      timestamp: since,
      buster: options.buster,
      clientState: dehydrate(
        client,
        options.shouldDehydrateQuery
          ? { shouldDehydrateQuery: options.shouldDehydrateQuery }
          : {},
      ),
    };
    void Promise.resolve(persister.persistClient(cleaned)).catch(() => undefined);
    if (isTracked(persister)) {
      await settledWithin(Promise.allSettled(persister.pendingSaves()), waitMs);
    }
    const deadline = Date.now() + confirmMs;
    for (;;) {
      const saved = await persister.restoreClient();
      if (saved && saved.timestamp >= since && nothingFromBefore(saved, since)) {
        return;
      }
      if (Date.now() >= deadline) {
        break;
      }
      if (options.saveNow) {
        await options.saveNow(cleaned);
      } else {
        await wait(POLL_MS);
      }
    }
  } catch {
    // Fall through: remove the copy.
  }
  try {
    await persister.removeClient();
  } catch {
    // Storage unavailable: nothing more can be done from here.
  }
}

/** Test-only: nothing registered. */
export function __resetSessionQueryCacheForTests(): void {
  registered = null;
}
