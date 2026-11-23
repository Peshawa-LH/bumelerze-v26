/**
 * The storage_purge queue of purge-home-photos (migration 0083): a deleted
 * account's folders are emptied, single files are removed, an entry leaves
 * the queue only when done, a failure keeps it, and nothing outside the
 * three photo buckets or outside a uuid folder is ever touched.
 */
import {
  entryKind,
  isPurgeBucket,
  purgeStorageQueue,
  type QueueEntry,
  type StorageQueuePorts,
} from "../storage-queue";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

type Files = Record<string, Record<string, string[]>>;

function fakePorts(files: Files, queue: QueueEntry[], failOn?: string) {
  const removed: string[] = [];
  const done: QueueEntry[] = [];
  const touched: string[] = [];
  const ports: StorageQueuePorts = {
    nextQueued: async (limit) => queue.slice(0, limit),
    listFiles: async (bucket, folder) => {
      touched.push(`${bucket}:${folder}`);
      if (failOn === `${bucket}:${folder}`) throw new Error("storage down");
      return [...(files[bucket]?.[folder] ?? [])];
    },
    removeFiles: async (bucket, paths) => {
      for (const path of paths) {
        touched.push(`${bucket}:${path}`);
        if (failOn === `${bucket}:${path}`) throw new Error("storage down");
        removed.push(`${bucket}:${path}`);
        const [folder, name] = path.split("/") as [string, string];
        const inBucket = (files[bucket] ??= {});
        inBucket[folder] = (inBucket[folder] ?? []).filter((n) => n !== name);
      }
    },
    markDone: async (entries) => {
      done.push(...entries);
    },
  };
  return { ports, removed, done, touched };
}

describe("entryKind and isPurgeBucket", () => {
  it("accepts a uuid folder and a plain file inside one", () => {
    expect(entryKind(U1)).toBe("folder");
    expect(entryKind(`${U1}/avatar-1.jpg`)).toBe("file");
  });

  it("refuses anything else", () => {
    for (const path of [
      "",
      "/",
      "abc",
      `${U1}/`,
      `${U1}/a/b.jpg`,
      `${U1}/..`,
      `${U1}/.`,
      `../${U1}`,
      "ABCDEF12-1111-4111-8111-111111111111",
      null,
      42,
    ]) {
      expect(entryKind(path)).toBeNull();
    }
  });

  it("knows the three photo buckets only", () => {
    expect(isPurgeBucket("avatars")).toBe(true);
    expect(isPurgeBucket("felt-photos")).toBe(true);
    expect(isPurgeBucket("feedback-photos")).toBe(true);
    expect(isPurgeBucket("home-photos")).toBe(false);
    expect(isPurgeBucket("atlas")).toBe(false);
  });
});

describe("purgeStorageQueue", () => {
  it("empties a deleted account's folders and removes single files", async () => {
    const f = fakePorts(
      {
        avatars: { [U1]: ["avatar-1.jpg", "avatar-2.jpg"] },
        "felt-photos": { [U1]: ["r1.jpg"], [U2]: ["r2.jpg", "r3.jpg"] },
        "feedback-photos": {},
      },
      [
        { bucket: "avatars", path: U1 },
        { bucket: "felt-photos", path: U1 },
        { bucket: "feedback-photos", path: U1 },
        { bucket: "felt-photos", path: `${U2}/r2.jpg` },
      ],
    );
    const summary = await purgeStorageQueue(f.ports);
    expect(f.removed.sort()).toEqual(
      [
        `avatars:${U1}/avatar-1.jpg`,
        `avatars:${U1}/avatar-2.jpg`,
        `felt-photos:${U1}/r1.jpg`,
        `felt-photos:${U2}/r2.jpg`,
      ].sort(),
    );
    // the other file in the guest folder stays
    expect(f.touched).not.toContain(`felt-photos:${U2}/r3.jpg`);
    expect(summary.done).toBe(4);
    expect(summary.failed).toBe(0);
    expect(f.done).toHaveLength(4);
  });

  it("keeps an entry queued when storage fails, and goes on with the rest", async () => {
    const f = fakePorts(
      { avatars: { [U1]: ["a.jpg"], [U2]: ["b.jpg"] } },
      [
        { bucket: "avatars", path: U1 },
        { bucket: "avatars", path: U2 },
      ],
      `avatars:${U1}`,
    );
    const summary = await purgeStorageQueue(f.ports);
    expect(summary.failed).toBe(1);
    expect(f.done).toEqual([{ bucket: "avatars", path: U2 }]);
    expect(f.removed).toEqual([`avatars:${U2}/b.jpg`]);
  });

  it("drops an entry it may not touch without calling storage", async () => {
    const f = fakePorts({}, [
      { bucket: "home-photos", path: U1 },
      { bucket: "avatars", path: "" },
      { bucket: "avatars", path: `${U1}/../x` },
    ]);
    const summary = await purgeStorageQueue(f.ports);
    expect(f.touched).toEqual([]);
    expect(summary.done).toBe(3);
    expect(summary.entries.every((e) => e.error === "not_allowed")).toBe(true);
  });

  it("gives up on a folder that never empties, until the next night", async () => {
    const ports: StorageQueuePorts = {
      nextQueued: async () => [{ bucket: "avatars", path: U1 }],
      listFiles: async () => ["same.jpg"],
      removeFiles: async () => undefined,
      markDone: async () => {
        throw new Error("should not be called");
      },
    };
    const summary = await purgeStorageQueue(ports, { maxRounds: 3 });
    expect(summary.failed).toBe(1);
    expect(summary.entries[0]?.error).toBe("too_many_files");
    expect(summary.entries[0]?.removed).toBe(3);
  });

  it("asks for at most the batch size", async () => {
    let asked = 0;
    const ports: StorageQueuePorts = {
      nextQueued: async (limit) => {
        asked = limit;
        return [];
      },
      listFiles: async () => [],
      removeFiles: async () => undefined,
      markDone: async () => undefined,
    };
    await purgeStorageQueue(ports, { batch: 10_000 });
    expect(asked).toBe(500);
  });
});
