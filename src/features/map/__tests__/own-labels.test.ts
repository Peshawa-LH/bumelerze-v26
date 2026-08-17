import {
  buildMergedOwnLabelFeatureCollection,
  buildOwnLabelFeatureCollection,
  buildOwnLabelsLayer,
  buildOwnLabelsSource,
  GAZETTEER_CONFLICT_RADIUS_KM,
  KURDISH_PLACE_MIN_ZOOM,
  KURDISH_PLACES_CORE,
  OWN_LABELS_ATTRIBUTION,
  OWN_LABELS_DEFAULT_FONT,
  OWN_LABELS_LAYER_ID,
  OWN_LABELS_SOURCE_ID,
  type OwnLabelsBbox,
} from "../own-labels";
import {
  GAZETTEER_CITIES,
  parseKurdishPlaces,
  type GazetteerCity,
  type KurdishPlace,
} from "@/features/geo";
import kurdishPlacesVillagesRaw from "@/features/geo/data/kurdish-places-villages.json";

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

function makePlace(overrides: Partial<KurdishPlace> = {}): KurdishPlace {
  return {
    id: "n1",
    lat: 36.5,
    lon: 44.5,
    tier: 3,
    names: { ckb: "گوندێک", kmr: "Gundek", ar: "قرية" },
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
      properties: { id: "erbil", label: "Erbil", tier: 0, minzoom: 0 },
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

describe("buildMergedOwnLabelFeatureCollection", () => {
  const gazetteer: GazetteerCity[] = [makeCity({ id: "erbil", lat: 36.19, lon: 44.01 })];

  it("merges gazetteer cities and Kurdish places into one feature collection", () => {
    const places: KurdishPlace[] = [
      makePlace({ id: "n1", lat: 36.6, lon: 44.6, tier: 2 }),
      makePlace({ id: "n2", lat: 37.0, lon: 45.0, tier: 3 }),
    ];

    const fc = buildMergedOwnLabelFeatureCollection(
      "en",
      REGION_BBOX_FIXTURE,
      gazetteer,
      places,
    );

    expect(fc.features.map((f) => f.id).sort()).toEqual(["erbil", "n1", "n2"].sort());
  });

  it("excludes Kurdish places outside the bbox, same as the gazetteer path", () => {
    const places: KurdishPlace[] = [makePlace({ id: "far-away", lat: 10, lon: 10 })];
    const fc = buildMergedOwnLabelFeatureCollection(
      "en",
      REGION_BBOX_FIXTURE,
      gazetteer,
      places,
    );
    expect(fc.features.some((f) => f.id === "far-away")).toBe(false);
  });

  it("gazetteer wins on conflict: a Kurdish place within the conflict radius of a gazetteer city is dropped", () => {
    // ~1.5km from Erbil (36.19, 44.01) — well inside GAZETTEER_CONFLICT_RADIUS_KM.
    const conflicting = makePlace({ id: "erbil-osm", lat: 36.2, lon: 44.02, tier: 1 });
    const fc = buildMergedOwnLabelFeatureCollection(
      "en",
      REGION_BBOX_FIXTURE,
      gazetteer,
      [conflicting],
    );
    expect(fc.features.some((f) => f.id === "erbil-osm")).toBe(false);
    // The gazetteer's own Erbil feature is still there, untouched.
    expect(fc.features.some((f) => f.id === "erbil")).toBe(true);
  });

  it("does NOT drop a genuinely distinct place well outside the conflict radius", () => {
    expect(GAZETTEER_CONFLICT_RADIUS_KM).toBeLessThan(10);
    // ~55km from Erbil — far outside the conflict radius.
    const distinct = makePlace({ id: "soran-ish", lat: 36.65, lon: 44.54, tier: 2 });
    const fc = buildMergedOwnLabelFeatureCollection(
      "en",
      REGION_BBOX_FIXTURE,
      gazetteer,
      [distinct],
    );
    expect(fc.features.some((f) => f.id === "soran-ish")).toBe(true);
  });

  it("assigns each Kurdish place's minzoom from KURDISH_PLACE_MIN_ZOOM by tier", () => {
    const places: KurdishPlace[] = [
      makePlace({ id: "city", lat: 36.6, lon: 44.6, tier: 1 }),
      makePlace({ id: "town", lat: 36.7, lon: 44.7, tier: 2 }),
      makePlace({ id: "village", lat: 36.8, lon: 44.8, tier: 3 }),
    ];
    const fc = buildMergedOwnLabelFeatureCollection(
      "en",
      REGION_BBOX_FIXTURE,
      gazetteer,
      places,
    );
    const byId = new Map(fc.features.map((f) => [f.id, f.properties]));
    expect(byId.get("city")?.minzoom).toBe(KURDISH_PLACE_MIN_ZOOM[1]);
    expect(byId.get("town")?.minzoom).toBe(KURDISH_PLACE_MIN_ZOOM[2]);
    expect(byId.get("village")?.minzoom).toBe(KURDISH_PLACE_MIN_ZOOM[3]);
    // Cities (tier 1) render as early as the gazetteer's tier 0, so a
    // zoomed-out view isn't missing every OSM-derived city just because it
    // wasn't hand-picked into the gazetteer.
    expect(KURDISH_PLACE_MIN_ZOOM[1]).toBe(0);
    // Villages are the strictly latest-appearing tier.
    expect(KURDISH_PLACE_MIN_ZOOM[3]).toBeGreaterThan(KURDISH_PLACE_MIN_ZOOM[2]);
    expect(KURDISH_PLACE_MIN_ZOOM[2]).toBeGreaterThan(KURDISH_PLACE_MIN_ZOOM[1]);
  });

  it("resolves each Kurdish place's label per the requested locale (ckb/kmr/ar fallback)", () => {
    const places: KurdishPlace[] = [
      makePlace({
        id: "n1",
        lat: 36.6,
        lon: 44.6,
        names: { ckb: "سۆران", kmr: "Soran", ar: "سوران" },
      }),
    ];
    const fcCkb = buildMergedOwnLabelFeatureCollection(
      "ckb",
      REGION_BBOX_FIXTURE,
      gazetteer,
      places,
    );
    expect(fcCkb.features.find((f) => f.id === "n1")?.properties.label).toBe("سۆران");

    const fcKmr = buildMergedOwnLabelFeatureCollection(
      "kmr",
      REGION_BBOX_FIXTURE,
      gazetteer,
      places,
    );
    expect(fcKmr.features.find((f) => f.id === "n1")?.properties.label).toBe("Soran");
  });

  it("skips a Kurdish place for a locale it has no fallback name for at all", () => {
    // Bypasses the schema's refine (impossible via parseKurdishPlaces) to
    // exercise resolveKurdishPlaceName's null-return path end-to-end.
    const places: KurdishPlace[] = [makePlace({ id: "blank", names: {} })];
    const fc = buildMergedOwnLabelFeatureCollection(
      "ckb",
      REGION_BBOX_FIXTURE,
      gazetteer,
      places,
    );
    expect(fc.features.some((f) => f.id === "blank")).toBe(false);
  });

  it("a place carrying only name:ar still renders (via the resolver's fallback), for every locale", () => {
    const places: KurdishPlace[] = [
      makePlace({
        id: "ar-only",
        lat: 36.6,
        lon: 44.6,
        tier: 1,
        names: { ar: "الفلوجة" },
      }),
    ];
    for (const locale of ["ckb", "kmr", "ar", "en"]) {
      const fc = buildMergedOwnLabelFeatureCollection(
        locale,
        REGION_BBOX_FIXTURE,
        gazetteer,
        places,
      );
      expect(fc.features.find((f) => f.id === "ar-only")?.properties.label).toBe(
        "الفلوجة",
      );
    }
  });

  it("defaults kurdishPlaces to KURDISH_PLACES_CORE when not passed", () => {
    const fc = buildMergedOwnLabelFeatureCollection("en", REGION_BBOX_FIXTURE, gazetteer);
    // KURDISH_PLACES_CORE (tier 1-2) is non-empty and, once gazetteer
    // conflicts are removed, still contributes features beyond the single
    // gazetteer fixture city passed in this test.
    expect(fc.features.length).toBeGreaterThan(1);
  });

  it("runs the full real dataset (gazetteer x KURDISH_PLACES_CORE) within a small time budget", () => {
    const start = Date.now();
    const fc = buildMergedOwnLabelFeatureCollection("ckb", REGION_BBOX_FIXTURE);
    const elapsedMs = Date.now() - start;
    expect(fc.features.length).toBeGreaterThan(0);
    // O(places x gazetteerCities) per own-labels.ts's isNearAnyGazetteerCity
    // doc comment — low thousands x a few dozen should be low-single-digit
    // milliseconds; 200ms is a generous CI-noise-tolerant budget, not a
    // tight perf assertion.
    expect(elapsedMs).toBeLessThan(200);
  });
});

describe("real dataset symbol counts by zoom tier (Part 2: report the marker count at a few zoom levels)", () => {
  it("reports how many labels are eligible at a few representative zoom levels", () => {
    const villages = parseKurdishPlaces(kurdishPlacesVillagesRaw);
    const fc = buildMergedOwnLabelFeatureCollection(
      "en",
      REGION_BBOX_FIXTURE,
      undefined,
      [...KURDISH_PLACES_CORE, ...villages],
    );
    const countAtZoom = (zoom: number) =>
      fc.features.filter((f) => f.properties.minzoom <= zoom).length;

    const zoomedOut = countAtZoom(5); // cities only (gazetteer + OSM tier 1)
    const midZoom = countAtZoom(8); // + towns/suburbs (tier 2)
    const closeZoom = countAtZoom(12); // + villages/hamlets (tier 3)

    expect(zoomedOut).toBeGreaterThan(0);
    expect(midZoom).toBeGreaterThanOrEqual(zoomedOut);
    expect(closeZoom).toBeGreaterThanOrEqual(midZoom);
    // Villages are the overwhelming majority of the dataset by design (Part
    // 1's tiering) — closeZoom should be substantially larger than midZoom,
    // not just "greater or equal".
    expect(closeZoom).toBeGreaterThan(midZoom);
  });
});

describe("buildOwnLabelsSource", () => {
  it("wraps the feature collection as a geojson source spec, with the OSM attribution", () => {
    const fc = buildOwnLabelFeatureCollection("en", REGION_BBOX_FIXTURE, [makeCity()]);
    expect(buildOwnLabelsSource(fc)).toEqual({
      type: "geojson",
      data: fc,
      attribution: OWN_LABELS_ATTRIBUTION,
    });
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

  it("filters by each feature's own minzoom property against the current zoom", () => {
    const layer = buildOwnLabelsLayer("dark");
    expect(layer.filter).toEqual([">=", ["zoom"], ["get", "minzoom"]]);
  });

  it("sizes text per tier, largest first (tier 0/1 city down to tier 3 village)", () => {
    const layer = buildOwnLabelsLayer("dark");
    expect(layer.layout?.["text-size"]).toEqual([
      "step",
      ["get", "tier"],
      15,
      1,
      14,
      2,
      13,
      3,
      12,
    ]);
  });

  it("uses the caller-supplied font stack when given, else the documented default", () => {
    const withFont = buildOwnLabelsLayer("light", [
      "Open Sans Medium",
      "Noto Sans Medium",
    ]);
    expect(withFont.layout?.["text-font"]).toEqual([
      "Open Sans Medium",
      "Noto Sans Medium",
    ]);

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

describe("KURDISH_PLACES_CORE (loaded + validated real bundled dataset)", () => {
  it("loads a non-empty, zod-validated array from the bundled JSON", () => {
    expect(KURDISH_PLACES_CORE.length).toBeGreaterThan(0);
  });

  it("only contains tier 1-2 places (tier 3/villages are the separate lazy-loaded file)", () => {
    expect(KURDISH_PLACES_CORE.every((p) => p.tier === 1 || p.tier === 2)).toBe(true);
  });

  it("real gazetteer cities that also exist in OSM stay suppressed (Erbil doesn't double up)", () => {
    const fc = buildMergedOwnLabelFeatureCollection(
      "ckb",
      REGION_BBOX_FIXTURE,
      GAZETTEER_CITIES,
    );
    const erbilLikeFeatures = fc.features.filter(
      (f) =>
        Math.abs((f.geometry.coordinates[1] as number) - 36.19) < 0.05 &&
        Math.abs((f.geometry.coordinates[0] as number) - 44.01) < 0.05,
    );
    // Exactly one label near Erbil's coordinates, not the gazetteer's PLUS
    // OSM's own separate Erbil city node.
    expect(erbilLikeFeatures).toHaveLength(1);
    expect(erbilLikeFeatures[0]?.id).toBe("erbil");
  });
});
