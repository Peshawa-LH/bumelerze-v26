import { magnitudeTone } from "@/features/events/magnitude-tone";
import { magnitudeBandPalette as magnitudePalette } from "@/theme/palette";

import {
  AFEAD_LAYER_ID,
  buildFaultsLayer,
  buildOverlaySpec,
  FAULTS_GEOJSON_URL,
  FAULTS_HIT_LAYER_ID,
  FAULTS_LAYER_ID,
  FAULTS_SOURCE_ID,
  HISTORICAL_LAYER_ID,
  OVERLAY_DATA_FILES,
  overlayDataUrl,
  VS30_IMAGE_URL,
  VS30_LAYER_ID,
  VS30_SOURCE_ID,
} from "../layer-registry";
import { buildRegionMarkers, type RegionMapMarker } from "../marker-helpers";
import {
  buildEventMarkerFeatureCollection,
  buildEventMarkerLayers,
  buildNativeOverlays,
  EVENT_MARKERS_CORE_LAYER_ID,
  EVENT_MARKERS_GLOW_LAYER_ID,
  EVENT_MARKERS_HALO_LAYER_ID,
  EVENT_MARKERS_SHADOW_LAYER_ID,
  EVENT_MARKERS_SOURCE_ID,
  markerCoreDiameterPx,
  NATIVE_OVERLAY_ANCHOR_IDS,
  overlayAnchorLayerId,
  pickPressedEventId,
  toNativeLayerProps,
  toNativeOwnLabels,
  toNativeSource,
} from "../native-layers";
import { buildOwnLabelsLayer, OWN_LABELS_LAYER_ID } from "../own-labels";
import { buildTerrainDemSource, TERRAIN_DEM_SOURCE_ID } from "../terrain";

const ORIGIN = "https://app.bumelerze.com";

function marker(overrides: Partial<RegionMapMarker> & { id: string }): RegionMapMarker {
  return {
    lon: 45,
    lat: 35,
    magnitudeValue: 4,
    tone: magnitudeTone(4),
    diameterPx: 20,
    isMostRecent: false,
    ...overrides,
  };
}

describe("toNativeLayerProps", () => {
  it("passes a style-spec layer through as <Layer> props, untouched", () => {
    const spec = buildFaultsLayer("dark");
    const props = toNativeLayerProps(spec);
    expect(props).toEqual({
      id: FAULTS_LAYER_ID,
      type: "line",
      source: FAULTS_SOURCE_ID,
      layout: spec.layout,
      paint: spec.paint,
    });
    // A copy: MapLibre may hold on to what it is given.
    expect(props.paint).not.toBe(spec.paint);
  });

  it("keeps the own-labels filter and sets beforeId only when given", () => {
    const spec = buildOwnLabelsLayer("light", ["Noto Sans Regular"]);
    expect(toNativeLayerProps(spec)).not.toHaveProperty("beforeId");
    const props = toNativeLayerProps(spec, "first-label");
    expect(props).toMatchObject({
      id: OWN_LABELS_LAYER_ID,
      type: "symbol",
      filter: [">=", ["zoom"], ["get", "minzoom"]],
      beforeId: "first-label",
    });
  });

  it("never writes a key the spec leaves out (the native side reads present-but-undefined as a value)", () => {
    const props = toNativeLayerProps({ id: "x", type: "background" });
    expect(Object.keys(props).sort()).toEqual(["id", "type"]);
  });
});

describe("toNativeSource", () => {
  it("maps a GeoJSON URL source", () => {
    expect(toNativeSource("s", { type: "geojson", data: "https://x/y.geojson" })).toEqual(
      {
        kind: "geojson",
        id: "s",
        data: "https://x/y.geojson",
      },
    );
  });

  it("maps the Vs30 image source with its four corners in MapLibre order", () => {
    const { source } = buildOverlaySpec("site-vs30", "light");
    const native = toNativeSource(VS30_SOURCE_ID, source as never);
    expect(native).toEqual({
      kind: "image",
      id: VS30_SOURCE_ID,
      url: VS30_IMAGE_URL,
      coordinates: [
        [33.6125, 43.9125],
        [55.545833, 43.9125],
        [55.545833, 26.2875],
        [33.6125, 26.2875],
      ],
    });
  });

  it("maps the terrain DEM with its terrarium encoding (Mapbox encoding would mis-read the heights)", () => {
    expect(toNativeSource(TERRAIN_DEM_SOURCE_ID, buildTerrainDemSource())).toMatchObject({
      kind: "raster-dem",
      encoding: "terrarium",
      tileSize: 256,
      maxzoom: 15,
    });
  });

  it("returns null for what the native maps never declare", () => {
    expect(toNativeSource("s", { type: "geojson", data: null })).toBeNull();
    expect(toNativeSource("s", { type: "raster-dem" })).toBeNull();
  });
});

describe("overlay files on the native app", () => {
  it("reads the files the web app serves, from APP_ORIGIN, stamped like the web's", () => {
    expect(overlayDataUrl("faults-gem", ORIGIN)).toMatch(
      /^https:\/\/app\.bumelerze\.com\/data\/gem-active-faults-region\.geojson\?v=.+$/,
    );
    // Same file names as the web build's own URLs.
    expect(FAULTS_GEOJSON_URL).toContain(`/data/${OVERLAY_DATA_FILES["faults-gem"]}?v=`);
  });

  it("buildOverlaySpec without a URL gives the web's own sources (the web is unchanged)", () => {
    expect(buildOverlaySpec("faults-gem", "light").source).toEqual({
      type: "geojson",
      data: FAULTS_GEOJSON_URL,
    });
    expect(buildOverlaySpec("site-vs30", "light").source).toMatchObject({
      url: VS30_IMAGE_URL,
    });
  });
});

describe("buildNativeOverlays", () => {
  it("is empty with every overlay off (the default)", () => {
    expect(buildNativeOverlays({}, "light", { origin: ORIGIN })).toEqual([]);
  });

  it("returns the switched-on overlays bottom of the stack first, from APP_ORIGIN", () => {
    const result = buildNativeOverlays(
      { "historical-quakes": true, "site-vs30": true, "faults-gem": true },
      "dark",
      { origin: ORIGIN },
    );
    expect(result.map((overlay) => overlay.id)).toEqual([
      "site-vs30",
      "faults-gem",
      "historical-quakes",
    ]);
    expect(result[0]?.source).toMatchObject({
      kind: "image",
      url: expect.stringContaining(ORIGIN),
    });
    expect(result[1]?.source).toMatchObject({
      kind: "geojson",
      data: expect.stringContaining(`${ORIGIN}/data/gem-active-faults-region.geojson`),
    });
    expect(result[1]?.layers.map((layer) => layer.id)).toEqual([
      FAULTS_LAYER_ID,
      FAULTS_HIT_LAYER_ID,
    ]);
    expect(result[2]?.layers.map((layer) => layer.id)).toEqual([HISTORICAL_LAYER_ID]);
    expect(result[0]?.layers.map((layer) => layer.id)).toEqual([VS30_LAYER_ID]);
  });

  it("[regression] puts every overlay under its OWN fixed placeholder, whatever else is on", () => {
    // MapLibre React Native 11.5 drops a layer whose beforeId changes after
    // it is on the map (simulator, 2026-10-20: switching the Layers on one
    // by one left only the last one visible). A beforeId that depended on
    // the other toggles was the trigger.
    const alone = buildNativeOverlays({ "faults-gem": true }, "light", {
      origin: ORIGIN,
    });
    const withOthers = buildNativeOverlays(
      { "faults-gem": true, "faults-afead": true, "historical-quakes": true },
      "light",
      { origin: ORIGIN },
    );
    const gemAlone = alone.find((overlay) => overlay.id === "faults-gem");
    const gemWithOthers = withOthers.find((overlay) => overlay.id === "faults-gem");
    expect(gemAlone?.layers.map((layer) => layer.beforeId)).toEqual([
      overlayAnchorLayerId("faults-gem"),
      overlayAnchorLayerId("faults-gem"),
    ]);
    expect(gemWithOthers?.layers.map((layer) => layer.beforeId)).toEqual(
      gemAlone?.layers.map((layer) => layer.beforeId),
    );
    const afead = withOthers.find((overlay) => overlay.id === "faults-afead");
    expect(afead?.layers[0]).toMatchObject({
      id: AFEAD_LAYER_ID,
      beforeId: overlayAnchorLayerId("faults-afead"),
    });
  });

  it("orders the placeholders as the web's OVERLAY_STACK, bottom first", () => {
    expect(NATIVE_OVERLAY_ANCHOR_IDS).toEqual([
      "bumelerze-anchor-site-vs30",
      "bumelerze-anchor-faults-gem",
      "bumelerze-anchor-faults-afead",
      "bumelerze-anchor-historical-quakes",
    ]);
  });
});

describe("toNativeOwnLabels", () => {
  it("respells Sorani labels for MapLibre Native's shaper and leaves the rest alone", () => {
    const collection = {
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          id: "hawler",
          properties: { id: "hawler", label: "هەولێر", tier: 0, minzoom: 0 },
          geometry: { type: "Point" as const, coordinates: [44.0, 36.19] },
        },
        {
          type: "Feature" as const,
          id: "duhok",
          properties: { id: "duhok", label: "Duhok", tier: 0, minzoom: 0 },
          geometry: { type: "Point" as const, coordinates: [43.0, 36.86] },
        },
      ],
    };
    const native = toNativeOwnLabels(collection);
    expect(native.features[0]?.properties.label).toBe("هه‌ولیٚر");
    expect(native.features[1]?.properties.label).toBe("Duhok");
    expect(native.features[0]?.geometry).toBe(collection.features[0]?.geometry);
    // The input is not mutated (it is memoised by the caller).
    expect(collection.features[0]?.properties.label).toBe("هەولێر");
  });
});

describe("event markers", () => {
  it("keeps the web's core-dot size rule (55 %, never under 6 px)", () => {
    expect(markerCoreDiameterPx(14)).toBe(8);
    expect(markerCoreDiameterPx(34)).toBe(19);
    expect(markerCoreDiameterPx(8)).toBe(6);
  });

  it("maps every marker to one feature with its size, core and tone, most recent last", () => {
    const collection = buildEventMarkerFeatureCollection([
      marker({
        id: "a",
        isMostRecent: true,
        diameterPx: 34,
        tone: "major",
        lon: 44,
        lat: 36,
      }),
      marker({ id: "b" }),
      marker({ id: "c" }),
    ]);
    expect(collection.features.map((feature) => feature.id)).toEqual(["b", "c", "a"]);
    expect(collection.features[2]).toEqual({
      type: "Feature",
      id: "a",
      properties: { id: "a", d: 34, core: 19, tone: "major", recent: true },
      geometry: { type: "Point", coordinates: [44, 36] },
    });
  });

  it("feeds straight from the web's own marker helper (size and tone from magnitude)", () => {
    const events = [
      { id: "e1", lon: 45.4, lat: 35.5, magnitude: { value: 6.5 }, originTime: 2 },
      { id: "e2", lon: 44.0, lat: 36.2, magnitude: { value: 2.1 }, originTime: 1 },
    ] as unknown as Parameters<typeof buildRegionMarkers>[0];
    const collection = buildEventMarkerFeatureCollection(buildRegionMarkers(events));
    const byId = Object.fromEntries(
      collection.features.map((feature) => [feature.id, feature.properties]),
    );
    expect(byId.e1).toMatchObject({ recent: true, tone: magnitudeTone(6.5) });
    expect(byId.e2).toMatchObject({ recent: false, tone: magnitudeTone(2.1) });
    expect(byId.e1?.d).toBeGreaterThan(byId.e2?.d ?? Infinity);
  });

  it("draws shadow or glow, halo, then core, all from the one event source", () => {
    const layers = buildEventMarkerLayers({
      magnitudeBand: magnitudePalette,
      felt: "#E11D2E",
      ring: "#FFFFFF",
    });
    expect(layers.map((layer) => layer.id)).toEqual([
      EVENT_MARKERS_SHADOW_LAYER_ID,
      EVENT_MARKERS_GLOW_LAYER_ID,
      EVENT_MARKERS_HALO_LAYER_ID,
      EVENT_MARKERS_CORE_LAYER_ID,
    ]);
    expect(layers.every((layer) => layer.source === EVENT_MARKERS_SOURCE_ID)).toBe(true);
    const halo = layers[2]?.paint ?? {};
    // The web's halo: 32 % of the tone colour, felt-red 2.5 px ring on the
    // most recent event, 1.5 px surface ring otherwise.
    expect(halo["circle-opacity"]).toBe(0.32);
    expect(halo["circle-color"]).toEqual([
      "match",
      ["get", "tone"],
      "minor",
      magnitudePalette.minor,
      "light",
      magnitudePalette.light,
      "moderate",
      magnitudePalette.moderate,
      "strong",
      magnitudePalette.strong,
      "major",
      magnitudePalette.major,
      magnitudePalette.minor,
    ]);
    expect(halo["circle-stroke-width"]).toEqual([
      "case",
      ["==", ["get", "recent"], true],
      2.5,
      1.5,
    ]);
    expect(halo["circle-stroke-color"]).toEqual([
      "case",
      ["==", ["get", "recent"], true],
      "#E11D2E",
      "#FFFFFF",
    ]);
    expect(layers[3]?.paint?.["circle-radius"]).toEqual(["/", ["get", "core"], 2]);
    expect(layers[3]?.paint?.["circle-opacity"]).toBe(1);
  });
});

describe("pickPressedEventId", () => {
  const feature = (id: string, lon: number, lat: number) => ({
    geometry: { type: "Point", coordinates: [lon, lat] },
    properties: { id },
  });

  it("picks the marker nearest the finger among overlapping ones", () => {
    expect(
      pickPressedEventId(
        [feature("far", 45.3, 35.5), feature("near", 45.02, 35.5)],
        [45, 35.5],
      ),
    ).toBe("near");
  });

  it("returns null when no feature carries an event id", () => {
    expect(pickPressedEventId([], [45, 35])).toBeNull();
    expect(
      pickPressedEventId([{ geometry: null, properties: { name: "x" } }], [45, 35]),
    ).toBeNull();
  });
});
