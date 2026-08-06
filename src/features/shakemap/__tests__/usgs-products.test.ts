import halabjaDetailFragment from "../__fixtures__/us2000bmcg/detail-fragment.json";
import { extractPreferredShakeMapProduct } from "../usgs-products";

describe("extractPreferredShakeMapProduct", () => {
  it("picks the preferred (highest preferredWeight) product from a real multi-product event", () => {
    const product = extractPreferredShakeMapProduct(halabjaDetailFragment);

    expect(product).not.toBeNull();
    // The fixture's "atlas" product (preferredWeight 321) must win over the
    // "us" product (preferredWeight 233) — a real two-competing-products
    // case, not a synthetic one (see fixture README).
    expect(product?.network).toBe("ATLAS");
    expect(product?.version).toBe(1);
    expect(product?.updateTime).toBe(1594400092790);
  });

  it("extracts the real cont_mi.json and info.json URLs from the preferred product's contents", () => {
    const product = extractPreferredShakeMapProduct(halabjaDetailFragment);

    expect(product?.contoursUrl).toBe(
      "https://earthquake.usgs.gov/product/shakemap/us2000bmcg/atlas/1594400092790/download/cont_mi.json",
    );
    expect(product?.infoUrl).toBe(
      "https://earthquake.usgs.gov/product/shakemap/us2000bmcg/atlas/1594400092790/download/info.json",
    );
  });

  it("returns null for an event with no shakemap products at all (the common small-event case)", () => {
    const noProductsPayload = {
      type: "Feature",
      properties: {
        products: {},
      },
    };

    expect(extractPreferredShakeMapProduct(noProductsPayload)).toBeNull();
  });

  it("returns null when properties.products is entirely absent", () => {
    const payload = { type: "Feature", properties: {} };
    expect(extractPreferredShakeMapProduct(payload)).toBeNull();
  });

  it("returns null for a structurally invalid payload rather than throwing", () => {
    expect(extractPreferredShakeMapProduct(null)).toBeNull();
    expect(extractPreferredShakeMapProduct("not json")).toBeNull();
    expect(extractPreferredShakeMapProduct({ type: "FeatureCollection" })).toBeNull();
  });

  it("returns null when the preferred product has no cont_mi.json content entry", () => {
    const payload = {
      type: "Feature",
      properties: {
        products: {
          shakemap: [
            {
              id: "urn:test",
              source: "test",
              updateTime: 123,
              preferredWeight: 1,
              properties: { version: "1" },
              contents: {
                "download/other.json": { url: "https://example.com/other.json" },
              },
            },
          ],
        },
      },
    };

    expect(extractPreferredShakeMapProduct(payload)).toBeNull();
  });

  it("skips malformed individual product entries instead of throwing", () => {
    const payload = {
      type: "Feature",
      properties: {
        products: {
          shakemap: [
            { id: "malformed-missing-required-fields" },
            {
              id: "urn:test",
              source: "test",
              updateTime: 456,
              preferredWeight: 1,
              properties: { version: "2" },
              contents: {
                "download/cont_mi.json": { url: "https://example.com/cont_mi.json" },
              },
            },
          ],
        },
      },
    };

    const product = extractPreferredShakeMapProduct(payload);
    expect(product?.network).toBe("TEST");
    expect(product?.version).toBe(2);
  });

  it("falls back to version 1 when the version string doesn't parse as a number", () => {
    const payload = {
      type: "Feature",
      properties: {
        products: {
          shakemap: [
            {
              id: "urn:test",
              source: "test",
              updateTime: 1,
              preferredWeight: 1,
              properties: { version: "not-a-number" },
              contents: {
                "download/cont_mi.json": { url: "https://example.com/cont_mi.json" },
              },
            },
          ],
        },
      },
    };

    expect(extractPreferredShakeMapProduct(payload)?.version).toBe(1);
  });
});
