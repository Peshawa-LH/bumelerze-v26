import {
  buildOwnLabelFeatureCollection,
  buildOwnLabelsLayer,
  buildOwnLabelsSource,
  OWN_LABELS_DEFAULT_FONT,
  OWN_LABELS_LAYER_ID,
  OWN_LABELS_SOURCE_ID,
  type OwnLabelsBbox,
} from "../own-labels";
import type { GazetteerCity } from "@/features/geo";

function makeCity(overrides: Partial<GazetteerCity> = {}): GazetteerCity {
  return {
    id: "erbil",
    names: { en: "Erbil", ckb: "هەولێر", kmr: "Hewlêr", ar: "أربيل" },
    lat: 36.19,
    lon: 44.01,
    country: "IQ",
    inKurdistanRegion: true,
    ...overrides,
  };
}

const REGION_BBOX_FIXTURE: OwnLabelsBbox = {
  minLat: 33.0,
  maxLat: 38.5,
  minLon: 41.0,
  maxLon: 48.5,
};

describe("buildOwnLabelFeatureCollection", () => {
  const cities: GazetteerCity[] = [
    makeCity({ id: "erbil", lat: 36.19, lon: 44.01 }),
    makeCity({
      id: "sanandaj",
      names: { en: "Sanandaj", ckb: "سنە", kmr: "Sine", ar: "سنندج" },
      lat: 35.31,
      lon: 47.0,
      country: "IR",
      inKurdistanRegion: false,
    }),
    // Far outside REGION_BBOX_FIXTURE (both lat and lon) — must be excluded.
    makeCity({
      id: "istanbul",
      names: { en: "Istanbul", ckb: "ئیستەنبوڵ", kmr: "Stenbol", ar: "إسطنبول" },
      lat: 41.0,
      lon: 28.9,
      country: "TR",
      inKurdistanRegion: false,
    }),
  ];

  it("includes only cities within the given bbox, as Point features", () => {
    const fc = buildOwnLabelFeatureCollection("en", REGION_BBOX_FIXTURE, cities);

    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features.map((f) => f.id)).toEqual(["erbil", "sanandaj"]);
    expect(fc.features[0]).toMatchObject({
      type: "Feature",
      geometry: { type: "Point", coordinates: [44.01, 36.19] },
      properties: { id: "erbil", label: "Erbil" },
    });
  });

  it("picks the label via the same pickLocalizedName choke point, per locale", () => {
    const fcCkb = buildOwnLabelFeatureCollection("ckb", REGION_BBOX_FIXTURE, cities);
    expect(fcCkb.features[0]?.properties.label).toBe("هەولێر");

    const fcAr = buildOwnLabelFeatureCollection("ar", REGION_BBOX_FIXTURE, cities);
    expect(fcAr.features[1]?.properties.label).toBe("سنندج");
  });

  it("falls back to English for a locale the gazetteer has no name for", () => {
    const fc = buildOwnLabelFeatureCollection("fr", REGION_BBOX_FIXTURE, cities);
    expect(fc.features[0]?.properties.label).toBe("Erbil");
  });

  it("defaults to the real GAZETTEER_CITIES when no cities array is passed", () => {
    const fc = buildOwnLabelFeatureCollection("en", REGION_BBOX_FIXTURE);
    expect(fc.features.length).toBeGreaterThan(0);
    expect(fc.features.some((f) => f.id === "erbil")).toBe(true);
  });
});

describe("buildOwnLabelsSource", () => {
  it("wraps the feature collection as a geojson source spec", () => {
    const fc = buildOwnLabelFeatureCollection("en", REGION_BBOX_FIXTURE, [makeCity()]);
    expect(buildOwnLabelsSource(fc)).toEqual({ type: "geojson", data: fc });
  });
});

describe("buildOwnLabelsLayer", () => {
  it("builds a text-only symbol layer reading the source's label property", () => {
    const layer = buildOwnLabelsLayer("dark");

    expect(layer.id).toBe(OWN_LABELS_LAYER_ID);
    expect(layer.type).toBe("symbol");
    expect(layer.source).toBe(OWN_LABELS_SOURCE_ID);
    expect(layer.layout?.["text-field"]).toEqual(["get", "label"]);
    // Participates in cross-layer collision (own-labels.ts's doc comment) —
    // both must stay MapLibre's own defaults, explicitly set.
    expect(layer.layout?.["text-allow-overlap"]).toBe(false);
    expect(layer.layout?.["text-ignore-placement"]).toBe(false);
  });

  it("uses the caller-supplied font stack when given, else the documented default", () => {
    const withFont = buildOwnLabelsLayer("light", ["Open Sans Medium", "Noto Sans Medium"]);
    expect(withFont.layout?.["text-font"]).toEqual(["Open Sans Medium", "Noto Sans Medium"]);

    const withoutFont = buildOwnLabelsLayer("light");
    expect(withoutFont.layout?.["text-font"]).toEqual([...OWN_LABELS_DEFAULT_FONT]);
  });

  it("tunes text/halo colors per scheme for readability", () => {
    const dark = buildOwnLabelsLayer("dark");
    const light = buildOwnLabelsLayer("light");

    expect(dark.paint?.["text-color"]).not.toEqual(light.paint?.["text-color"]);
    expect(dark.paint?.["text-halo-color"]).not.toEqual(light.paint?.["text-halo-color"]);
  });
});
