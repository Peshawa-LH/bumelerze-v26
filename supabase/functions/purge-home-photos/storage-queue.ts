// Pure logic of the second queue the purge-home-photos function drains
// (migration 0083). No Deno, no network: index.ts hands in the ports, and
// Jest drives this file directly with fakes.
//
// `storage_purge` holds photo files and folders to remove from the
// avatars, felt-photos and feedback-photos buckets: a deleted account's
// folders, and the file of every felt or feedback photo row that was
// deleted (account deletion, the nightly retention purge, an admin).
// Postgres cannot delete storage objects, so the database queues them and
// this removes them through the Storage API.
//
// An entry is either a folder (an account's uuid: every file directly
// under it) or one file (`<uuid>/<name>`). Anything else, or a bucket
// outside the three, is dropped from the queue without touching storage.
// Idempotent: an empty folder or a file already gone is simply done; a
// failure leaves the entry queued for the next night.

export const PURGE_BUCKETS = ["avatars", "felt-photos", "feedback-photos"] as const;
export type PurgeBucket = (typeof PURGE_BUCKETS)[number];

export interface QueueEntry {
  bucket: string;
  path: string;
}

export interface StorageQueuePorts {
  /** Oldest queued entries, at most `limit`. */
  nextQueued(limit: number): Promise<QueueEntry[]>;
  /** File names directly under `<folder>/` in `bucket`, at most one page. */
  listFiles(bucket: PurgeBucket, folder: string): Promise<string[]>;
  /** Removes full object paths from `bucket`. */
  removeFiles(bucket: PurgeBucket, paths: string[]): Promise<void>;
  /** Takes finished entries off the queue. */
  markDone(entries: QueueEntry[]): Promise<void>;
}

export interface StorageQueueOptions {
  /** Entries handled per call (default 100). */
  batch?: number;
  /** List/remove rounds per folder before giving up until next time (default 20). */
  maxRounds?: number;
  /** Paths per remove call (default 100). */
  chunk?: number;
}

export interface EntryResult extends QueueEntry {
  removed: number;
  done: boolean;
  error?: string;
}

export interface StorageQueueSummary {
  entries: EntryResult[];
  removed: number;
  done: number;
  failed: number;
}

const UUID_TEXT = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const FOLDER = new RegExp(`^${UUID_TEXT}$`);
const FILE = new RegExp(`^${UUID_TEXT}/([^/]+)$`);

export function isPurgeBucket(value: unknown): value is PurgeBucket {
  return (
    typeof value === "string" && (PURGE_BUCKETS as readonly string[]).includes(value)
  );
}

/** "folder", "file", or null for a path this function never touches. */
export function entryKind(path: unknown): "folder" | "file" | null {
  if (typeof path !== "string") return null;
  if (FOLDER.test(path)) return "folder";
  const file = FILE.exec(path);
  if (file && file[1] !== "." && file[1] !== "..") return "file";
  return null;
}

function plainNames(folder: string, names: readonly string[]): string[] {
  return names
    .filter(
      (name) => name.length > 0 && !name.includes("/") && name !== "." && name !== "..",
    )
    .map((name) => `${folder}/${name}`);
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function purgeEntry(
  ports: StorageQueuePorts,
  bucket: PurgeBucket,
  path: string,
  kind: "folder" | "file",
  maxRounds: number,
  chunk: number,
): Promise<{ removed: number; done: boolean; error?: string }> {
  if (kind === "file") {
    await ports.removeFiles(bucket, [path]);
    return { removed: 1, done: true };
  }
  let removed = 0;
  for (let round = 0; round < maxRounds; round += 1) {
    const paths = plainNames(path, await ports.listFiles(bucket, path));
    if (paths.length === 0) {
      return { removed, done: true };
    }
    for (const part of chunks(paths, chunk)) {
      await ports.removeFiles(bucket, part);
      removed += part.length;
    }
  }
  return { removed, done: false, error: "too_many_files" };
}

export async function purgeStorageQueue(
  ports: StorageQueuePorts,
  options: StorageQueueOptions = {},
): Promise<StorageQueueSummary> {
  const batch = Math.max(1, Math.min(options.batch ?? 100, 500));
  const maxRounds = Math.max(1, options.maxRounds ?? 20);
  const chunk = Math.max(1, Math.min(options.chunk ?? 100, 1000));

  const queued = await ports.nextQueued(batch);
  const entries: EntryResult[] = [];
  const finished: QueueEntry[] = [];
  for (const entry of queued) {
    const kind = entryKind(entry.path);
    if (!isPurgeBucket(entry.bucket) || kind === null) {
      entries.push({ ...entry, removed: 0, done: true, error: "not_allowed" });
      finished.push(entry);
      continue;
    }
    try {
      const result = await purgeEntry(
        ports,
        entry.bucket,
        entry.path,
        kind,
        maxRounds,
        chunk,
      );
      entries.push({ ...entry, ...result });
      if (result.done) {
        finished.push(entry);
      }
    } catch (error) {
      entries.push({
        ...entry,
        removed: 0,
        done: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (finished.length > 0) {
    await ports.markDone(finished);
  }
  return {
    entries,
    removed: entries.reduce((sum, entry) => sum + entry.removed, 0),
    done: finished.length,
    failed: entries.filter((entry) => !entry.done).length,
  };
}
