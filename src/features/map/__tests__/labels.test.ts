import {
  buildArabicNameTextField,
  findNameLabelLayerIds,
  isNameLabelLayer,
  shouldLocalizeToArabicScript,
  type StyleLayerLike,
} from "../labels";

describe("shouldLocalizeToArabicScript", () => {
  it("is true for ckb and ar", () => {
    expect(shouldLocalizeToArabicScript("ckb")).toBe(true);
    expect(shouldLocalizeToArabicScript("ar")).toBe(true);
  });

  it("is false for kmr, en, and unrecognized locale strings", () => {
    expect(shouldLocalizeToArabicScript("kmr")).toBe(false);
    expect(shouldLocalizeToArabicScript("en")).toBe(false);
    expect(shouldLocalizeToArabicScript("fr")).toBe(false);
  });
});

describe("buildArabicNameTextField", () => {
  it("returns a coalesce(name:ar, name) expression", () => {
    expect(buildArabicNameTextField()).toEqual([
      "coalesce",
      ["get", "name:ar"],
      ["get", "name"],
    ]);
  });

  it("returns a fresh array each call (no shared mutable reference)", () => {
    expect(buildArabicNameTextField()).not.toBe(buildArabicNameTextField());
  });
});

describe("isNameLabelLayer", () => {
  it("is true for a plain ['get', 'name'] text-field", () => {
    expect(
      isNameLabelLayer({ type: "symbol", layout: { "text-field": ["get", "name"] } }),
    ).toBe(true);
  });

  it("is true for openfreemap's real name:latin/name:nonlatin case expression", () => {
    // Verified live against tiles.openfreemap.org/styles/liberty (2026-08-16).
    const textField = [
      "case",
      ["has", "name:nonlatin"],
      ["concat", ["get", "name:latin"], "\n", ["get", "name:nonlatin"]],
      ["coalesce", ["get", "name_en"], ["get", "name"]],
    ];
    expect(
      isNameLabelLayer({ type: "symbol", layout: { "text-field": textField } }),
    ).toBe(true);
  });

  it("is true for an already-localized coalesce(name:ar, name) text-field (idempotent detection)", () => {
    expect(
      isNameLabelLayer({
        type: "symbol",
        layout: { "text-field": ["coalesce", ["get", "name:ar"], ["get", "name"]] },
      }),
    ).toBe(true);
  });

  it("is false for a road-shield layer using ['get', 'ref'], not a name field", () => {
    expect(
      isNameLabelLayer({
        type: "symbol",
        layout: { "text-field": ["to-string", ["get", "ref"]] },
      }),
    ).toBe(false);
  });

  it("is false for non-symbol layers even if they somehow had a text-field", () => {
    expect(
      isNameLabelLayer({ type: "line", layout: { "text-field": ["get", "name"] } }),
    ).toBe(false);
  });

  it("is false for symbol layers with no text-field at all (icon-only POI layers)", () => {
    expect(isNameLabelLayer({ type: "symbol", layout: { "icon-image": "poi" } })).toBe(
      false,
    );
    expect(isNameLabelLayer({ type: "symbol" })).toBe(false);
  });
});

describe("findNameLabelLayerIds", () => {
  it("returns only the ids of name-labeling symbol layers, in style order", () => {
    const layers: StyleLayerLike[] = [
      { id: "land", type: "fill" },
      { id: "roads", type: "line" },
      { id: "road-shield", type: "symbol", layout: { "text-field": ["get", "ref"] } },
      { id: "city-labels", type: "symbol", layout: { "text-field": ["get", "name"] } },
      { id: "poi-labels", type: "symbol", layout: { "text-field": ["get", "name"] } },
    ];
    expect(findNameLabelLayerIds(layers)).toEqual(["city-labels", "poi-labels"]);
  });

  it("returns an empty array when there are no name-labeling layers", () => {
    const layers: StyleLayerLike[] = [{ id: "land", type: "fill" }];
    expect(findNameLabelLayerIds(layers)).toEqual([]);
  });
});
