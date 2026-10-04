import ar from "../../../i18n/locales/ar.json";
import ckb from "../../../i18n/locales/ckb.json";
import en from "../../../i18n/locales/en.json";
import kmr from "../../../i18n/locales/kmr.json";
import {
  activeOverlayIds,
  AFEAD_HIT_LAYER_ID,
  AFEAD_LAYER_ID,
  applyFaultsOverlay,
  applyMapOverlay,
  applyMapOverlays,
  buildAfeadLayer,
  buildFaultsLayer,
  buildHistoricalLayer,
  buildVs30Source,
  FAULTS_HIT_LAYER_ID,
  FAULTS_LAYER_ID,
  FAULTS_SOURCE_ID,
  HISTORICAL_LAYER_ID,
  isOverlayOn,
  MAP_LAYERS,
  OVERLAY_STACK,
  TOGGLEABLE_MAP_LAYERS,
  VS30_LAYER_ID,
} from "../layer-registry";
import { VS30_OVERLAY_BOUNDS, VS30_OVERLAY_CLASSES } from "../vs30-overlay";

function lookup(tree: unknown, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], tree);
}

/** A tiny stand-in for a MapLibre map: an ordered layer list and a source set. */
function fakeMap(initial: string[] = ["water", "labels"]) {
  const layers = [...initial];
  const sources = new Set<string>();
  const map = {
    layers,
    sources,
    getStyle: () => ({
      layers: initial.map((id) => ({ id, type: id === "labels" ? "symbol" : "fill" })),
    }),
    getLayer: (id: string) => (layers.includes(id) ? { id } : undefined),
    getSource: (id: string) => (sources.has(id) ? { id } : undefined),
    addSource: jest.fn((id: string) => sources.add(id)),
    addLayer: jest.fn((spec: { id: string }, beforeId?: string) => {
      layers.splice(beforeId ? layers.indexOf(beforeId) : layers.length, 0, spec.id);
    }),
    removeLayer: (id: string) => layers.splice(layers.indexOf(id), 1),
    removeSource: (id: string) => sources.delete(id),
  };
  return map;
}

describe("map layer registry", () => {
  it("has unique ids, only earthquakes on by default, and every label in all four locales", () => {
    expect(new Set(MAP_LAYERS.map((l) => l.id)).size).toBe(MAP_LAYERS.length);
    expect(MAP_LAYERS.filter((l) => l.defaultOn).map((l) => l.id)).toEqual(["events"]);
    for (const layer of MAP_LAYERS) {
      for (const locale of [en, ckb, kmr, ar]) {
        expect(typeof lookup(locale, layer.titleKey)).toBe("string");
        expect(typeof lookup(locale, layer.attributionKey)).toBe("string");
      }
      expect(layer.license.length).toBeGreaterThan(0);
      expect(layer.sourceUrl).toMatch(/^https:\/\//);
    }
  });

  it("offers two fault sources, past earthquakes and ground conditions, all off unless chosen", () => {
    expect(TOGGLEABLE_MAP_LAYERS.map((l) => l.id)).toEqual([
      "faults-afead",
      "faults-gem",
      "historical-quakes",
      "site-vs30",
    ]);
    expect(isOverlayOn({}, "faults-afead")).toBe(false);
    expect(isOverlayOn({ "faults-gem": true }, "faults-gem")).toBe(true);
    expect(isOverlayOn({}, "events")).toBe(true);
    expect(activeOverlayIds({ "site-vs30": true, "faults-gem": false })).toEqual([
      "site-vs30",
    ]);
    expect([...OVERLAY_STACK].sort()).toEqual(
      TOGGLEABLE_MAP_LAYERS.map((l) => l.id).sort(),
    );
  });

  it("colours both fault sources by slip family and fades AFEAD by confidence", () => {
    expect(JSON.stringify(buildFaultsLayer("dark").paint?.["line-color"])).toContain(
      "slip_type",
    );
    const afead = buildAfeadLayer("light");
    expect(JSON.stringify(afead.paint?.["line-color"])).toContain('"s1"');
    expect(JSON.stringify(afead.paint?.["line-opacity"])).toContain('"c"');
  });

  it("sizes past earthquakes by magnitude and colours them by era", () => {
    const layer = buildHistoricalLayer("dark");
    expect(JSON.stringify(layer.paint?.["circle-radius"])).toContain('"m"');
    expect(JSON.stringify(layer.paint?.["circle-color"])).toContain('"era"');
  });

  it("pins the ground image to its generated corners", () => {
    const { west, east, north, south } = VS30_OVERLAY_BOUNDS;
    expect(buildVs30Source("x.png").coordinates).toEqual([
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ]);
    expect(VS30_OVERLAY_CLASSES.length).toBeGreaterThan(0);
    for (const c of VS30_OVERLAY_CLASSES) {
      for (const locale of [en, ckb, kmr, ar]) {
        expect(typeof lookup(locale, `map.legend.siteClass${c}`)).toBe("string");
      }
    }
  });

  it("adds an overlay with its tap twin under the labels, idempotently, and removes it cleanly", () => {
    const map = fakeMap();
    applyFaultsOverlay(map as never, true, "light");
    expect(map.layers).toEqual(["water", FAULTS_LAYER_ID, FAULTS_HIT_LAYER_ID, "labels"]);
    applyFaultsOverlay(map as never, true, "light");
    expect(map.addLayer).toHaveBeenCalledTimes(2);
    applyFaultsOverlay(map as never, false, "light");
    expect(map.layers).toEqual(["water", "labels"]);
    expect(map.sources.size).toBe(0);
    expect(map.sources.has(FAULTS_SOURCE_ID)).toBe(false);
  });

  it("keeps the stack order whatever order layers are switched on", () => {
    const map = fakeMap();
    applyMapOverlay(map as never, "historical-quakes", true, "light");
    applyMapOverlay(map as never, "faults-afead", true, "light");
    applyMapOverlay(map as never, "site-vs30", true, "light");
    applyMapOverlay(map as never, "faults-gem", true, "dark");
    expect(map.layers).toEqual([
      "water",
      VS30_LAYER_ID,
      FAULTS_LAYER_ID,
      FAULTS_HIT_LAYER_ID,
      AFEAD_LAYER_ID,
      AFEAD_HIT_LAYER_ID,
      HISTORICAL_LAYER_ID,
      "labels",
    ]);
  });

  it("re-applies the persisted set after a style swap and does nothing before a style exists", () => {
    const map = fakeMap();
    applyMapOverlays(map as never, { "faults-afead": true, "site-vs30": true }, "light");
    expect(map.layers).toEqual([
      "water",
      VS30_LAYER_ID,
      AFEAD_LAYER_ID,
      AFEAD_HIT_LAYER_ID,
      "labels",
    ]);
    const empty = { ...fakeMap(), getStyle: () => undefined };
    applyMapOverlays(empty as never, { "faults-afead": true }, "light");
    expect(empty.addLayer).not.toHaveBeenCalled();
  });
});
