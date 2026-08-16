import {
  buildTerrainDemSource,
  buildTerrainHillshadeLayer,
  findHillshadeBeforeLayerId,
  styleHasRasterDemSource,
  TERRAIN_ATTRIBUTION,
  TERRAIN_DEM_SOURCE_ID,
  TERRAIN_HILLSHADE_LAYER_ID,
  TERRAIN_TILE_URL_TEMPLATE,
  type StyleLayerTypeInfo,
} from "../terrain";

describe("styleHasRasterDemSource", () => {
  it("is false when there are no sources at all", () => {
    expect(styleHasRasterDemSource(undefined)).toBe(false);
    expect(styleHasRasterDemSource({})).toBe(false);
  });

  it("is false when sources exist but none are raster-dem", () => {
    expect(
      styleHasRasterDemSource({
        openmaptiles: { type: "vector" },
        satellite: { type: "raster" },
      }),
    ).toBe(false);
  });

  it("is true when a raster-dem source is present (e.g. maptiler's outdoor terrain)", () => {
    expect(
      styleHasRasterDemSource({
        openmaptiles: { type: "vector" },
        terrain: { type: "raster-dem" },
      }),
    ).toBe(true);
  });
});

describe("buildTerrainDemSource", () => {
  it("uses the terrarium-encoded AWS Open Data terrain tiles with a source-level attribution", () => {
    const source = buildTerrainDemSource();
    expect(source.type).toBe("raster-dem");
    expect(source.tiles).toEqual([TERRAIN_TILE_URL_TEMPLATE]);
    expect(source.encoding).toBe("terrarium");
    expect(source.attribution).toBe(TERRAIN_ATTRIBUTION);
  });
});

describe("buildTerrainHillshadeLayer", () => {
  it("targets the DEM source and uses the shared hillshade layer id", () => {
    const layer = buildTerrainHillshadeLayer("light");
    expect(layer.id).toBe(TERRAIN_HILLSHADE_LAYER_ID);
    expect(layer.type).toBe("hillshade");
    expect(layer.source).toBe(TERRAIN_DEM_SOURCE_ID);
  });

  it("is subtler in dark mode: lower exaggeration and lower-alpha shadow/highlight colors", () => {
    const light = buildTerrainHillshadeLayer("light");
    const dark = buildTerrainHillshadeLayer("dark");

    expect(dark.paint?.["hillshade-exaggeration"]).toBeLessThan(
      light.paint?.["hillshade-exaggeration"] as number,
    );

    // Alpha is the 4th component of the rgba(...) string — lower in dark
    // mode so the relief reads as texture, not mud, on the dark basemap.
    const alphaOf = (rgba: unknown) =>
      Number(String(rgba).split(",")[3]?.replace(")", ""));
    expect(alphaOf(dark.paint?.["hillshade-shadow-color"])).toBeLessThan(
      alphaOf(light.paint?.["hillshade-shadow-color"]),
    );
    expect(alphaOf(dark.paint?.["hillshade-highlight-color"])).toBeLessThan(
      alphaOf(light.paint?.["hillshade-highlight-color"]),
    );
  });
});

describe("findHillshadeBeforeLayerId", () => {
  it("inserts before the first line layer when fills come before lines", () => {
    const layers: StyleLayerTypeInfo[] = [
      { id: "land", type: "fill" },
      { id: "water", type: "fill" },
      { id: "roads", type: "line" },
      { id: "labels", type: "symbol" },
    ];
    expect(findHillshadeBeforeLayerId(layers)).toBe("roads");
  });

  it("inserts before the first symbol layer when there are no line layers", () => {
    const layers: StyleLayerTypeInfo[] = [
      { id: "land", type: "fill" },
      { id: "poi-labels", type: "symbol" },
    ];
    expect(findHillshadeBeforeLayerId(layers)).toBe("poi-labels");
  });

  it("prefers whichever of line/symbol comes first in style order", () => {
    const layers: StyleLayerTypeInfo[] = [
      { id: "land", type: "fill" },
      { id: "poi-labels", type: "symbol" },
      { id: "roads", type: "line" },
    ];
    expect(findHillshadeBeforeLayerId(layers)).toBe("poi-labels");
  });

  it("returns undefined (append on top) when the style has no line/symbol layer", () => {
    const layers: StyleLayerTypeInfo[] = [{ id: "land", type: "fill" }];
    expect(findHillshadeBeforeLayerId(layers)).toBeUndefined();
  });

  it("returns undefined for an empty layer list", () => {
    expect(findHillshadeBeforeLayerId([])).toBeUndefined();
  });
});
