import { ATLAS_EVENT_IDS, ATLAS_INDEX } from "../atlas";
import { loadAtlasEntry, peekAtlasEntry, WEB_ATLAS_LOADERS } from "../atlas-source.web";

describe("atlas-source.web (bundled maps downloaded per event on the web)", () => {
  it("lists exactly the events of the generated Atlas index", () => {
    expect([...WEB_ATLAS_LOADERS.keys()].sort()).toEqual([...ATLAS_EVENT_IDS].sort());
  });

  it("is not loaded until asked, then returns the same product as the index", async () => {
    expect(peekAtlasEntry("us2000bmcg")).toBeUndefined();
    const entry = await loadAtlasEntry("us2000bmcg");
    expect(entry?.version).toBe(ATLAS_INDEX.us2000bmcg?.version);
    expect(peekAtlasEntry("us2000bmcg")).toBe(entry);
  });

  it("answers null at once for an event without a bundled map", async () => {
    expect(peekAtlasEntry("us7000abcd")).toBeNull();
    await expect(loadAtlasEntry("us7000abcd")).resolves.toBeNull();
  });
});
