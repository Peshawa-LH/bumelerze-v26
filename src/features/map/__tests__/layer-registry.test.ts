import ar from "../../../i18n/locales/ar.json";
import ckb from "../../../i18n/locales/ckb.json";
import en from "../../../i18n/locales/en.json";
import kmr from "../../../i18n/locales/kmr.json";
import {
  applyFaultsOverlay,
  buildFaultsLayer,
  FAULTS_LAYER_ID,
  FAULTS_SOURCE_ID,
  isOverlayOn,
  MAP_LAYERS,
  TOGGLEABLE_MAP_LAYERS,
} from "../layer-registry";

function lookup(tree: unknown, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], tree);
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
    }
  });

  it("offers the fault lines as a toggle, off unless chosen", () => {
    expect(TOGGLEABLE_MAP_LAYERS.map((l) => l.id)).toEqual(["faults-gem"]);
    expect(isOverlayOn({}, "faults-gem")).toBe(false);
    expect(isOverlayOn({ "faults-gem": true }, "faults-gem")).toBe(true);
    expect(isOverlayOn({}, "events")).toBe(true);
  });

  it("draws faults as lines coloured by slip type", () => {
    const layer = buildFaultsLayer("dark");
    expect(layer.type).toBe("line");
    expect(layer.source).toBe(FAULTS_SOURCE_ID);
    expect(JSON.stringify(layer.paint?.["line-color"])).toContain("slip_type");
  });

  it("adds the overlay under the first symbol layer and removes it cleanly", () => {
    const layers: string[] = ["water", "labels"];
    const sources = new Set<string>();
    const map = {
      getStyle: () => ({
        layers: [
          { id: "water", type: "fill" },
          { id: "labels", type: "symbol" },
        ],
      }),
      getLayer: (id: string) => (layers.includes(id) ? { id } : undefined),
      getSource: (id: string) => (sources.has(id) ? { id } : undefined),
      addSource: (id: string) => sources.add(id),
      addLayer: jest.fn((spec: { id: string }, beforeId?: string) => {
        layers.splice(beforeId ? layers.indexOf(beforeId) : layers.length, 0, spec.id);
      }),
      removeLayer: (id: string) => layers.splice(layers.indexOf(id), 1),
      removeSource: (id: string) => sources.delete(id),
    };
    applyFaultsOverlay(map as never, true, "light");
    expect(layers).toEqual(["water", FAULTS_LAYER_ID, "labels"]);
    applyFaultsOverlay(map as never, true, "light");
    expect(map.addLayer).toHaveBeenCalledTimes(1);
    applyFaultsOverlay(map as never, false, "light");
    expect(layers).toEqual(["water", "labels"]);
    expect(sources.size).toBe(0);
  });
});
