import {
  clearStyleSessionCache,
  insertAnchorLayers,
  loadStyleDocument,
  parseStyleDocument,
  prepareNativeMapStyle,
  styleStorageKey,
  type StyleDocument,
} from "../native-style";
import { OWN_LABELS_DEFAULT_FONT } from "../own-labels";
import { TERRAIN_DEM_SOURCE_ID, TERRAIN_HILLSHADE_LAYER_ID } from "../terrain";

function styleDoc(overrides: Partial<StyleDocument> = {}): StyleDocument {
  return {
    version: 8,
    name: "test",
    sources: { planet: { type: "vector", url: "https://tiles/x.json" } },
    layers: [
      { id: "background", type: "background" },
      { id: "water", type: "fill", source: "planet" },
      { id: "roads", type: "line", source: "planet" },
      {
        id: "road-shields",
        type: "symbol",
        source: "planet",
        layout: { "text-field": ["get", "ref"], "text-font": ["Shield Font"] },
      },
      {
        id: "place-city",
        type: "symbol",
        source: "planet",
        layout: {
          "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
          "text-font": ["Open Sans Medium", "Noto Sans Medium"],
        },
      },
    ],
    ...overrides,
  } as StyleDocument;
}

describe("parseStyleDocument", () => {
  it("accepts a style document and keeps every key it does not check", () => {
    const parsed = parseStyleDocument({
      ...styleDoc(),
      glyphs: "https://g/{fontstack}/{range}",
    });
    expect(parsed?.glyphs).toBe("https://g/{fontstack}/{range}");
  });

  it("rejects anything that is not one", () => {
    expect(parseStyleDocument(null)).toBeNull();
    expect(parseStyleDocument({ version: 8, layers: [] })).toBeNull();
    expect(parseStyleDocument("<html>quota exceeded</html>")).toBeNull();
  });
});

describe("prepareNativeMapStyle", () => {
  it("switches name labels to coalesce(name:ar, name) for Sorani and Arabic, like the web", () => {
    for (const locale of ["ckb", "ar"]) {
      const { style } = prepareNativeMapStyle(styleDoc(), {
        locale,
        scheme: "light",
        terrain: false,
      });
      const city = style.layers.find((layer) => layer.id === "place-city");
      expect(city?.layout?.["text-field"]).toEqual([
        "coalesce",
        ["get", "name:ar"],
        ["get", "name"],
      ]);
      // A road shield is not a name label.
      const shields = style.layers.find((layer) => layer.id === "road-shields");
      expect(shields?.layout?.["text-field"]).toEqual(["get", "ref"]);
    }
  });

  it("keeps the style's own labels in English and Kurmanji, and never edits the input", () => {
    const doc = styleDoc();
    for (const locale of ["en", "kmr"]) {
      const { style } = prepareNativeMapStyle(doc, {
        locale,
        scheme: "dark",
        terrain: false,
      });
      expect(
        style.layers.find((layer) => layer.id === "place-city")?.layout?.["text-field"],
      ).toEqual(["coalesce", ["get", "name:en"], ["get", "name"]]);
    }
    prepareNativeMapStyle(doc, { locale: "ckb", scheme: "dark", terrain: true });
    expect(doc.layers).toHaveLength(5);
    expect(doc.sources[TERRAIN_DEM_SOURCE_ID]).toBeUndefined();
  });

  it("adds the AWS hillshade under the first line or label layer when the style has no relief", () => {
    const { style } = prepareNativeMapStyle(styleDoc(), {
      locale: "en",
      scheme: "light",
      terrain: true,
    });
    expect(style.sources[TERRAIN_DEM_SOURCE_ID]).toMatchObject({
      type: "raster-dem",
      encoding: "terrarium",
    });
    expect(style.layers.map((layer) => layer.id)).toEqual([
      "background",
      "water",
      TERRAIN_HILLSHADE_LAYER_ID,
      "roads",
      "road-shields",
      "place-city",
    ]);
  });

  it("leaves a style with its own raster-dem (MapTiler outdoor) without a second hillshade", () => {
    const { style } = prepareNativeMapStyle(
      styleDoc({
        sources: {
          planet: { type: "vector" },
          "terrain-rgb": { type: "raster-dem" },
        },
      }),
      { locale: "en", scheme: "light", terrain: true },
    );
    expect(style.sources[TERRAIN_DEM_SOURCE_ID]).toBeUndefined();
    expect(style.layers.some((layer) => layer.id === TERRAIN_HILLSHADE_LAYER_ID)).toBe(
      false,
    );
  });

  it("borrows the style's own label font for the Kurdish labels, falling back to Noto Sans", () => {
    expect(
      prepareNativeMapStyle(styleDoc(), { locale: "en", scheme: "light", terrain: false })
        .ownLabelsFont,
    ).toEqual(["Open Sans Medium", "Noto Sans Medium"]);
    expect(
      prepareNativeMapStyle(styleDoc({ layers: [{ id: "bg", type: "background" }] }), {
        locale: "en",
        scheme: "light",
        terrain: false,
      }).ownLabelsFont,
    ).toEqual(OWN_LABELS_DEFAULT_FONT);
  });

  it("puts the placeholder layers under the first label, in order, and reports that label", () => {
    const prepared = prepareNativeMapStyle(styleDoc(), {
      locale: "en",
      scheme: "light",
      terrain: false,
      anchorLayerIds: ["anchor-a", "anchor-b"],
    });
    expect(prepared.style.layers.map((layer) => layer.id)).toEqual([
      "background",
      "water",
      "roads",
      "anchor-a",
      "anchor-b",
      "road-shields",
      "place-city",
    ]);
    expect(prepared.style.layers[3]).toEqual({
      id: "anchor-a",
      type: "background",
      layout: { visibility: "none" },
    });
    expect(prepared.firstSymbolLayerId).toBe("road-shields");
  });
});

describe("insertAnchorLayers", () => {
  it("appends the placeholders on top of a style without labels", () => {
    const doc = styleDoc({ layers: [{ id: "bg", type: "background" }] });
    insertAnchorLayers(doc, ["a"]);
    expect(doc.layers.map((layer) => layer.id)).toEqual(["bg", "a"]);
  });
});

describe("loadStyleDocument", () => {
  const URL = "https://api.maptiler.com/maps/outdoor-v4/style.json?key=SECRET";

  function memoryStorage(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    return {
      data,
      getItem: jest.fn(async (key: string) => data.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        data.set(key, value);
      }),
    };
  }

  function okResponse(body: unknown) {
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  }

  beforeEach(() => clearStyleSessionCache());

  it("keys the saved copy without the MapTiler key", () => {
    expect(styleStorageKey(URL)).toBe(
      "bumelerze.map-style:https://api.maptiler.com/maps/outdoor-v4/style.json?key",
    );
    expect(styleStorageKey("https://tiles.openfreemap.org/styles/liberty")).toBe(
      "bumelerze.map-style:https://tiles.openfreemap.org/styles/liberty",
    );
  });

  it("fetches the document, keeps it for the session and saves it for offline starts", async () => {
    const storage = memoryStorage();
    const fetchImpl = jest.fn(async () => okResponse(styleDoc()));
    const doc = await loadStyleDocument(URL, { fetchImpl: fetchImpl as never, storage });
    expect(doc.layers).toHaveLength(5);
    expect(storage.setItem).toHaveBeenCalledWith(
      styleStorageKey(URL),
      expect.any(String),
    );
    await loadStyleDocument(URL, { fetchImpl: fetchImpl as never, storage });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("opens offline from the copy saved on an earlier run", async () => {
    const storage = memoryStorage({ [styleStorageKey(URL)]: JSON.stringify(styleDoc()) });
    const fetchImpl = jest.fn(async () => {
      throw new TypeError("Network request failed");
    });
    const doc = await loadStyleDocument(URL, { fetchImpl: fetchImpl as never, storage });
    expect(doc.name).toBe("test");
  });

  it("rejects when neither the network nor the device has it (a bad key, first run offline)", async () => {
    const storage = memoryStorage();
    const forbidden = jest.fn(async () => ({ ok: false, status: 403 }) as Response);
    await expect(
      loadStyleDocument(URL, { fetchImpl: forbidden as never, storage }),
    ).rejects.toThrow("style 403");
    const garbage = jest.fn(async () => okResponse({ error: "quota" }));
    await expect(
      loadStyleDocument(URL, { fetchImpl: garbage as never, storage }),
    ).rejects.toThrow("wrong shape");
  });
});
