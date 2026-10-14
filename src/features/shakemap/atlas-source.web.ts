import type { AtlasBundleEntry } from "./types";

/**
 * Web version of `atlas-source.ts`: each of the eleven bundled Atlas
 * products (`atlas/data/*.json`, about 0.5 MB compressed together) is its
 * own download, fetched the first time its event is opened, instead of
 * being part of the first page load. Keep this list in step with
 * `atlas/index.ts` (generated); `__tests__/atlas-source-web.test.ts` fails
 * when they differ.
 */
type Loader = () => Promise<unknown>;

export const WEB_ATLAS_LOADERS: ReadonlyMap<string, Loader> = new Map<string, Loader>([
  ["iscgem899464", () => import("./atlas/data/iscgem899464.json")],
  ["iscgem898547", () => import("./atlas/data/iscgem898547.json")],
  ["iscgem884317", () => import("./atlas/data/iscgem884317.json")],
  ["iscgem839648", () => import("./atlas/data/iscgem839648.json")],
  ["usp0001bb6", () => import("./atlas/data/usp0001bb6.json")],
  ["usp0004uk3", () => import("./atlas/data/usp0004uk3.json")],
  ["us2000bmcg", () => import("./atlas/data/us2000bmcg.json")],
  ["us1000ghda", () => import("./atlas/data/us1000ghda.json")],
  ["us1000hwdw", () => import("./atlas/data/us1000hwdw.json")],
  ["us6000jllz", () => import("./atlas/data/us6000jllz.json")],
  ["us6000jlqa", () => import("./atlas/data/us6000jlqa.json")],
]);

const loaded = new Map<string, AtlasBundleEntry>();

export function peekAtlasEntry(eventId: string): AtlasBundleEntry | null | undefined {
  if (!WEB_ATLAS_LOADERS.has(eventId)) {
    return null;
  }
  return loaded.get(eventId);
}

export async function loadAtlasEntry(eventId: string): Promise<AtlasBundleEntry | null> {
  const loader = WEB_ATLAS_LOADERS.get(eventId);
  if (!loader) {
    return null;
  }
  const cached = loaded.get(eventId);
  if (cached) {
    return cached;
  }
  const module = (await loader()) as { default?: unknown };
  const entry = (module.default ?? module) as AtlasBundleEntry;
  loaded.set(eventId, entry);
  return entry;
}
