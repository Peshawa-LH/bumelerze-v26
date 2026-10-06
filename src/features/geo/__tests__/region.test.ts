import { GAZETTEER_CITIES } from "../gazetteer";
import { isPointInKurdistanRegion, resolveRegionLabelKey } from "../region";

describe("isPointInKurdistanRegion", () => {
  it("is true for Erbil, Slemani, and Duhok's own coordinates", () => {
    expect(isPointInKurdistanRegion(36.19, 44.01)).toBe(true);
    expect(isPointInKurdistanRegion(35.56, 45.43)).toBe(true);
    expect(isPointInKurdistanRegion(36.87, 42.99)).toBe(true);
  });

  it("is false for a point far outside the bbox (e.g. Baghdad)", () => {
    expect(isPointInKurdistanRegion(33.31, 44.36)).toBe(false);
  });
});

describe("resolveRegionLabelKey", () => {
  const city = (id: string) => GAZETTEER_CITIES.find((candidate) => candidate.id === id)!;

  it("labels a KRG-flagged nearest city as Kurdistan (Iraq)", () => {
    expect(resolveRegionLabelKey(city("erbil"))).toBe("kurdistanIraq");
    expect(resolveRegionLabelKey(city("slemani"))).toBe("kurdistanIraq");
  });

  it("labels an Iranian nearest city with its own country", () => {
    expect(resolveRegionLabelKey(city("javanrud"))).toBe("iran");
  });

  it("labels a non-KRG Iraqi nearest city as Iraq", () => {
    expect(resolveRegionLabelKey(city("baghdad"))).toBe("iraq");
  });

  it("describes where the CITY is, never where the epicentre falls (one city, one label)", () => {
    // Kirkuk and Khanaqin are flagged outside the KRG, yet their coordinates
    // sit inside the simplified KRG bbox. The old rule let any epicentre inside
    // the bbox turn them into "Kurdistan (Iraq)", so Khanaqin read "Iraq" for
    // one event and "Kurdistan (Iraq)" for the next.
    for (const id of ["kirkuk", "khanaqin"]) {
      expect(city(id).inKurdistanRegion).toBe(false);
      expect(resolveRegionLabelKey(city(id))).toBe("iraq");
    }
  });
});
