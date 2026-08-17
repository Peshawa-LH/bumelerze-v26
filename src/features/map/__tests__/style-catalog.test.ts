import {
  DEFAULT_MAP_STYLE_CATALOG_ID,
  MAP_STYLE_CATALOG_IDS,
  MAP_STYLE_LABEL_KEYS,
  resolveCatalogMapStyle,
} from "../style-catalog";

describe("MAP_STYLE_CATALOG_IDS", () => {
  it("lists exactly the five curated candidates, outdoor first", () => {
    expect(MAP_STYLE_CATALOG_IDS).toEqual(["outdoor", "topo", "hybrid", "dataviz", "openfreemap"]);
  });

  it("defaults to outdoor — today's shipped default basemap", () => {
    expect(DEFAULT_MAP_STYLE_CATALOG_ID).toBe("outdoor");
  });

  it("gives every catalog id a label key", () => {
    for (const id of MAP_STYLE_CATALOG_IDS) {
      expect(MAP_STYLE_LABEL_KEYS[id]).toBe(`map.style.${id}`);
    }
  });
});

describe("resolveCatalogMapStyle", () => {
  const KEY = "test-key-123";

  it("resolves a MapTiler-family entry to its scheme-specific style id when a key is configured", () => {
    expect(resolveCatalogMapStyle("outdoor", "light", KEY)).toEqual({
      provider: "maptiler",
      url: "https://api.maptiler.com/maps/outdoor-v4/style.json?key=test-key-123",
    });
    expect(resolveCatalogMapStyle("outdoor", "dark", KEY)).toEqual({
      provider: "maptiler",
      url: "https://api.maptiler.com/maps/outdoor-v4-dark/style.json?key=test-key-123",
    });
    expect(resolveCatalogMapStyle("topo", "light", KEY)).toEqual({
      provider: "maptiler",
      url: "https://api.maptiler.com/maps/topo-v4/style.json?key=test-key-123",
    });
    expect(resolveCatalogMapStyle("dataviz", "dark", KEY)).toEqual({
      provider: "maptiler",
      url: "https://api.maptiler.com/maps/dataviz-v4-dark/style.json?key=test-key-123",
    });
  });

  it("resolves hybrid to the SAME style id in both color schemes (no day/night satellite variant)", () => {
    expect(resolveCatalogMapStyle("hybrid", "light", KEY)).toEqual({
      provider: "maptiler",
      url: "https://api.maptiler.com/maps/hybrid/style.json?key=test-key-123",
    });
    expect(resolveCatalogMapStyle("hybrid", "dark", KEY)).toEqual({
      provider: "maptiler",
      url: "https://api.maptiler.com/maps/hybrid/style.json?key=test-key-123",
    });
  });

  it("resolves openfreemap to the OpenFreeMap urls regardless of whether a MapTiler key is configured", () => {
    expect(resolveCatalogMapStyle("openfreemap", "light", KEY).provider).toBe("openfreemap");
    expect(resolveCatalogMapStyle("openfreemap", "dark", null).provider).toBe("openfreemap");
  });

  it("degrades a MapTiler-family entry to OpenFreeMap when no key is configured", () => {
    const resolved = resolveCatalogMapStyle("topo", "light", null);
    expect(resolved.provider).toBe("openfreemap");
  });

  it("degrades to OpenFreeMap when forceProvider pins it, even with a key configured (runtime fallback)", () => {
    const resolved = resolveCatalogMapStyle("hybrid", "dark", KEY, "openfreemap");
    expect(resolved.provider).toBe("openfreemap");
  });
});
