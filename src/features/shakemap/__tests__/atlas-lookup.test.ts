import { NOTABLE_HISTORICAL_EVENTS } from "@/features/historical";
import { ATLAS_INDEX } from "../atlas";
import { resolveAtlasLookupId } from "../atlas-lookup";

/**
 * "resolve by either id (bml first through the notable mapping, then
 * provider id)" — the bundled Atlas index stays keyed by provider id
 * (`atlas/index.ts`, generated), but a `/event/[id]` visit for one of the
 * 11 curated events may now only carry its bml id, never the provider id
 * directly (owner directive 2026-09-02). `resolveAtlasLookupId` is the one
 * function that closes that gap for `useShakeMap`'s lookup key.
 */
describe("resolveAtlasLookupId", () => {
  it("resolves every curated event's bml id straight to its bundled Atlas provider-id key", () => {
    for (const event of NOTABLE_HISTORICAL_EVENTS) {
      const key = resolveAtlasLookupId({
        id: "unused-fallback",
        bumelerzeId: event.bumelerzeId,
      });
      expect(key).toBe(event.id);
      expect(ATLAS_INDEX[key]).toBeTruthy();
    }
  });

  it("falls back to the event's own id when the bml id is unknown/not curated", () => {
    expect(resolveAtlasLookupId({ id: "us9999zzzz", bumelerzeId: null })).toBe(
      "us9999zzzz",
    );
    expect(resolveAtlasLookupId({ id: "us9999zzzz", bumelerzeId: "bml20260123" })).toBe(
      "us9999zzzz",
    );
  });

  it("prefers the bml-resolved provider id over the event's own id when both are present", () => {
    const halabja = NOTABLE_HISTORICAL_EVENTS.find(
      (event) => event.noteKey === "halabja2017",
    );
    expect(halabja).toBeDefined();
    const key = resolveAtlasLookupId({
      id: "some-other-provider-id",
      bumelerzeId: halabja!.bumelerzeId,
    });
    expect(key).toBe(halabja!.id);
  });
});
