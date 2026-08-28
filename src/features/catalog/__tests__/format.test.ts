import i18n from "@/i18n";

import { formatCatalogPlace } from "../format";
import type { CatalogRow } from "../types";

/**
 * The far-field place fallback (2026-08-28).
 *
 * The catalog reaches from 28.5 to 39.5 N and 38 to 50.5 E, while the app's
 * bundled gazetteer covers Kurdistan and Iraq. 85% of the 150,072 events
 * therefore sit outside gazetteer range, and before this change every one
 * of them rendered as a bare coordinate pair like "38.163, 38.459".
 *
 * `region` carries the locating agency's own description for those rows.
 * It must NOT displace the Kurdish gazetteer where that has something
 * close, which is the first test below.
 */
function makeRow(overrides: Partial<CatalogRow> = {}): CatalogRow {
  return {
    bumelerzeId: "bml20260001",
    time: 1_760_000_000,
    year: 2026,
    lat: 35.56,
    lon: 45.43,
    depthKm: 10,
    mag: 4.2,
    magType: "mb",
    sourceCatalog: "ISC",
    sourceId: "600873714",
    contributingSources: "ISC",
    mergedCount: 1,
    authorAgency: "ISN",
    region: null,
    ...overrides,
  };
}

describe("formatCatalogPlace", () => {
  const t = i18n.t.bind(i18n);

  it("prefers the Kurdish gazetteer over the agency region inside Kurdistan", () => {
    // Sulaimani. The agency would call this "Iraq"; the gazetteer can do
    // far better, and a Kurdish-first app must not regress to the coarser
    // label just because one is present.
    const line = formatCatalogPlace(
      makeRow({ lat: 35.56, lon: 45.43, region: "Iraq" }),
      "en",
      t,
    );
    expect(line).not.toBe("Iraq");
    expect(line.length).toBeGreaterThan("Iraq".length);
  });

  it("falls back to the agency region when the gazetteer has nothing close", () => {
    // Far western Turkey, well outside the gazetteer.
    const line = formatCatalogPlace(
      makeRow({ lat: 38.163, lon: 38.459, region: "13 km NNE of Sincik, Turkey" }),
      "en",
      t,
    );
    expect(line).toContain("Sincik");
  });

  it("falls back to coordinates only when there is no region either", () => {
    // The ~13% of rows no FDSN response covered: pre-instrumental and
    // regional-catalog records.
    const line = formatCatalogPlace(
      makeRow({ lat: 38.163, lon: 38.459, region: null }),
      "en",
      t,
    );
    expect(line).toMatch(/38\.16/);
  });
});
