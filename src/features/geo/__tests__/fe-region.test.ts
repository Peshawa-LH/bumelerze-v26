import { FE_GRID_ROWS, FE_REGION_NAMES_EN } from "../data/fe-regions.generated";
import { FE_REGION_COUNT, flinnEngdahlNameEn, flinnEngdahlNumber } from "../fe-region";

/** [lat, lon, expected F-E region number], produced with the reference
 * implementation (ObsPy `FlinnEngdahl.get_number`, USGS/NEIC tables). The set
 * covers every quadrant, both poles, the 0/180 meridians and Kurdistan. */
const REFERENCE: readonly (readonly [number, number, number])[] = [
  [35.56, 45.43, 346], // Iran-Iraq border region (Sulaimani)
  [36.19, 44.01, 346], // Erbil
  [36.34, 43.13, 375], // Iraq (Mosul)
  [35.69, 51.39, 348], // Northern and central Iran
  [35.68, 139.69, 230], // Near south coast of Honshu
  [-4.35, 152.27, 192], // New Britain region
  [-18, 178, 182], // Fiji Islands
  [33, 139.5, 211], // Southeast of Honshu
  [-33.4, -70.7, 127], // Chile-Argentina border region
  [61.2, -149.9, 2], // Southern Alaska
  [41, 29, 366], // Turkey
  [-30, -178, 178], // Kermadec Islands, New Zealand
  [3, 96, 706], // Northern Sumatra
  [0, -180, 618], // antimeridian, west side
  [0, 180, 618], // antimeridian, east side
  [-8.5, 115.2, 283], // Bali region
  [90, 0, 633], // North pole
  [-90, 10, 729], // South pole
  [0, 0, 561], // origin
  [-0.5, -0.5, 409], // just inside the south-west quadrant
  [89.99, 179.99, 633],
  [10, 100, 708], // Gulf of Thailand
  [-6.2, -71.1, 113], // Western Brazil
  [-45.9, 170.5, 162], // South Island, New Zealand
  [38.1, 37.2, 366], // Turkey (Elbistan)
  [31.5, 34.8, 373], // Dead Sea region
  [25.3, 55.3, 351], // Eastern Arabian Peninsula
  [23.7, 90.4, 316], // Bangladesh
  [64.1, -21.9, 638], // Iceland
  [-12, 166, 184], // Santa Cruz Islands
];

describe("flinnEngdahlNumber", () => {
  it.each(REFERENCE)(
    "(%f, %f) is F-E region %i, matching the reference implementation",
    (lat, lon, expected) => {
      expect(flinnEngdahlNumber(lat, lon)).toBe(expected);
    },
  );

  it("returns null for coordinates that are not on the globe", () => {
    expect(flinnEngdahlNumber(Number.NaN, 10)).toBeNull();
    expect(flinnEngdahlNumber(10, Number.POSITIVE_INFINITY)).toBeNull();
    expect(flinnEngdahlNumber(91, 0)).toBeNull();
    expect(flinnEngdahlNumber(0, 181)).toBeNull();
    expect(flinnEngdahlNumber(0, -181)).toBeNull();
  });

  it("resolves every whole-degree cell of the globe to a valid region", () => {
    for (let lat = -90; lat <= 90; lat += 1) {
      for (let lon = -180; lon <= 180; lon += 1) {
        const n = flinnEngdahlNumber(lat, lon);
        expect(n).not.toBeNull();
        expect(n!).toBeGreaterThanOrEqual(1);
        expect(n!).toBeLessThanOrEqual(FE_REGION_COUNT);
      }
    }
  });
});

describe("Flinn-Engdahl tables", () => {
  it("has 757 readable English names and the 4 x 91 latitude rows", () => {
    expect(FE_REGION_NAMES_EN).toHaveLength(757);
    expect(FE_GRID_ROWS).toHaveLength(4 * 91);
    // Abbreviations and typos of the raw tables are expanded at build time.
    for (const name of FE_REGION_NAMES_EN) {
      expect(name).not.toMatch(/\b(?:N\.Z|P\.N\.G|PNG|REG|BORD|BRD)\b/i);
      expect(name.length).toBeGreaterThan(2);
    }
  });

  it("names regions by number", () => {
    expect(flinnEngdahlNameEn(366)).toBe("Turkey");
    expect(flinnEngdahlNameEn(346)).toBe("Iran-Iraq border region");
    expect(flinnEngdahlNameEn(230)).toBe("Near south coast of Honshu, Japan");
    expect(flinnEngdahlNameEn(0)).toBeNull();
    expect(flinnEngdahlNameEn(758)).toBeNull();
  });
});
