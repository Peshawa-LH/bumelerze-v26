// Pure logic of the purge-home-photos function (migration 0061). No Deno, no
// network: index.ts hands in the ports, and Jest drives this file directly
// with fakes (supabase/functions/purge-home-photos/__tests__).
//
// What it does: a deleted home (purged from the 14-day trash, deleted now,
// deleted by its owner the old way, or gone with the owner's account) leaves
// its photo files in the private `home-photos` bucket under `<tag_id>/`,
// because Postgres cannot delete storage objects. A trigger queues the tag id
// in `home_photo_purge`; this drains the queue through the Storage API.
//
// Idempotent and safe to re-run: a folder that is already empty is simply
// marked done, a failure leaves the tag queued for the next night, and a
// queue entry that is not a uuid is never used as a folder (an empty or odd
// prefix could otherwise list, and remove, files outside one home).

export interface PurgePorts {
  /** Oldest queued tag ids, at most `limit`. */
  nextQueued(limit: number): Promise<string[]>;
  /** File names directly under `<folder>/`, at most one page. */
  listFiles(folder: string): Promise<string[]>;
  /** Removes full object paths (`<folder>/<name>`). */
  removeFiles(paths: string[]): Promise<void>;
  /** Takes finished tag ids off the queue. */
  markDone(tagIds: string[]): Promise<void>;
}

export interface PurgeOptions {
  /** Tags handled per call (default 25). */
  batch?: number;
  /** List/remove rounds per folder before giving up until next time (default 20). */
  maxRounds?: number;
  /** Paths per remove call (default 100). */
  chunk?: number;
}

export interface FolderResult {
  tagId: string;
  removed: number;
  done: boolean;
  error?: string;
}

export interface PurgeSummary {
  folders: FolderResult[];
  removed: number;
  done: number;
  failed: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isTagId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** `<tag>/<name>` for each plain file name; names with a slash or empty are skipped. */
export function objectPaths(tagId: string, names: readonly string[]): string[] {
  return names
    .filter(
      (name) => name.length > 0 && !name.includes("/") && name !== "." && name !== "..",
    )
    .map((name) => `${tagId}/${name}`);
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function purgeFolder(
  ports: PurgePorts,
  tagId: string,
  maxRounds: number,
  chunk: number,
): Promise<FolderResult> {
  let removed = 0;
  for (let round = 0; round < maxRounds; round += 1) {
    const paths = objectPaths(tagId, await ports.listFiles(tagId));
    if (paths.length === 0) {
      return { tagId, removed, done: true };
    }
    for (const part of chunks(paths, chunk)) {
      await ports.removeFiles(part);
      removed += part.length;
    }
  }
  return { tagId, removed, done: false, error: "too_many_files" };
}

export async function purgeHomePhotos(
  ports: PurgePorts,
  options: PurgeOptions = {},
): Promise<PurgeSummary> {
  const batch = Math.max(1, Math.min(options.batch ?? 25, 100));
  const maxRounds = Math.max(1, options.maxRounds ?? 20);
  const chunk = Math.max(1, Math.min(options.chunk ?? 100, 1000));

  const queued = await ports.nextQueued(batch);
  const folders: FolderResult[] = [];
  const finished: string[] = [];
  for (const tagId of queued) {
    if (!isTagId(tagId)) {
      // never a folder name: drop it from the queue without touching storage
      folders.push({
        tagId: String(tagId),
        removed: 0,
        done: true,
        error: "not_a_tag_id",
      });
      finished.push(String(tagId));
      continue;
    }
    try {
      const result = await purgeFolder(ports, tagId, maxRounds, chunk);
      folders.push(result);
      if (result.done) {
        finished.push(tagId);
      }
    } catch (error) {
      folders.push({
        tagId,
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
    folders,
    removed: folders.reduce((sum, folder) => sum + folder.removed, 0),
    done: finished.length,
    failed: folders.filter((folder) => !folder.done).length,
  };
}
