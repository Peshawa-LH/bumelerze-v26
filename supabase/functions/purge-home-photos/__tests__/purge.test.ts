/**
 * The pure part of purge-home-photos (migration 0061), run under Jest like the
 * other functions' logic: queued folders are emptied through the ports, the
 * queue entry goes only once the folder is empty, a failure keeps it queued,
 * and nothing that is not a home's uuid is ever used as a folder.
 */
import { isTagId, objectPaths, purgeHomePhotos, type PurgePorts } from "../purge";

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";

function fakePorts(files: Record<string, string[]>, queue: string[], failOn?: string) {
  const removed: string[] = [];
  const done: string[] = [];
  const listed: string[] = [];
  const ports: PurgePorts = {
    nextQueued: async (limit) => queue.slice(0, limit),
    listFiles: async (folder) => {
      listed.push(folder);
      if (failOn === folder) throw new Error("storage down");
      return [...(files[folder] ?? [])];
    },
    removeFiles: async (paths) => {
      for (const path of paths) {
        removed.push(path);
        const [folder, name] = path.split("/") as [string, string];
        files[folder] = (files[folder] ?? []).filter((n) => n !== name);
      }
    },
    markDone: async (ids) => {
      done.push(...ids);
    },
  };
  return { ports, removed, done, listed };
}

describe("purgeHomePhotos", () => {
  it("empties each queued folder and then takes it off the queue", async () => {
    const f = fakePorts({ [T1]: ["front.jpg", "back.jpg"], [T2]: [] }, [T1, T2]);
    const summary = await purgeHomePhotos(f.ports);
    expect(f.removed.sort()).toEqual([`${T1}/back.jpg`, `${T1}/front.jpg`]);
    expect(f.done).toEqual([T1, T2]);
    expect(summary).toMatchObject({ removed: 2, done: 2, failed: 0 });
  });

  it("is idempotent: a second run finds nothing and removes nothing", async () => {
    const files = { [T1]: ["a.jpg"] };
    await purgeHomePhotos(fakePorts(files, [T1]).ports);
    const again = fakePorts(files, [T1]);
    const summary = await purgeHomePhotos(again.ports);
    expect(again.removed).toEqual([]);
    expect(summary.removed).toBe(0);
  });

  it("keeps a folder queued when storage fails, and carries on with the rest", async () => {
    const f = fakePorts({ [T1]: ["a.jpg"], [T2]: ["b.jpg"] }, [T1, T2], T1);
    const summary = await purgeHomePhotos(f.ports);
    expect(f.done).toEqual([T2]);
    expect(summary.failed).toBe(1);
    expect(summary.folders.find((x) => x.tagId === T1)?.error).toBe("storage down");
  });

  it("never lists or removes with a queue entry that is not a uuid", async () => {
    const f = fakePorts({ "": ["root.jpg"] }, ["", "../x", T1]);
    await purgeHomePhotos(f.ports);
    expect(f.listed).toEqual([T1]);
    expect(f.removed).toEqual([]);
    expect(f.done).toEqual(["", "../x", T1]);
  });

  it("removes in chunks and stops after the round limit (left queued)", async () => {
    const many = Array.from({ length: 7 }, (_, i) => `p${i}.jpg`);
    const files: Record<string, string[]> = { [T1]: many };
    const f = fakePorts(files, [T1]);
    // listFiles returns a page; make the fake refill so the folder never empties
    f.ports.listFiles = async () => ["again.jpg"];
    const summary = await purgeHomePhotos(f.ports, { maxRounds: 3, chunk: 2 });
    expect(summary.folders[0]).toMatchObject({
      done: false,
      error: "too_many_files",
      removed: 3,
    });
    expect(f.done).toEqual([]);
  });

  it("caps the batch at 100 tags per call", async () => {
    const asked: number[] = [];
    const f = fakePorts({}, []);
    f.ports.nextQueued = async (limit) => {
      asked.push(limit);
      return [];
    };
    await purgeHomePhotos(f.ports, { batch: 5000 });
    expect(asked).toEqual([100]);
  });
});

describe("helpers", () => {
  it("recognises a tag id", () => {
    expect(isTagId(T1)).toBe(true);
    expect(isTagId("")).toBe(false);
    expect(isTagId("BMH-ABC123")).toBe(false);
  });

  it("builds object paths from plain names only", () => {
    expect(objectPaths(T1, ["a.jpg", "", "x/y.jpg", "..", "b.png"])).toEqual([
      `${T1}/a.jpg`,
      `${T1}/b.png`,
    ]);
  });
});
