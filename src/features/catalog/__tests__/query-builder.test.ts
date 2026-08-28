import {
  buildCatalogBoundsQuery,
  buildCatalogCountQuery,
  buildCatalogPageQuery,
} from "../query-builder";
import type { CatalogFilters } from "../types";

describe("buildCatalogPageQuery", () => {
  it("has no WHERE clause when no filters are set", () => {
    const { sql, params } = buildCatalogPageQuery({}, 40, 0);
    expect(sql).not.toContain("WHERE");
    expect(sql).toContain("ORDER BY t DESC LIMIT ? OFFSET ?");
    expect(params).toEqual([40, 0]);
  });

  it("filters by magnitude range only", () => {
    const filters: CatalogFilters = { magMin: 4.0, magMax: 6.5 };
    const { sql, params } = buildCatalogPageQuery(filters, 40, 0);
    expect(sql).toContain("WHERE mag >= ? AND mag <= ?");
    expect(params).toEqual([4.0, 6.5, 40, 0]);
  });

  it("filters by year range only", () => {
    const filters: CatalogFilters = { yearMin: 1990, yearMax: 2020 };
    const { sql, params } = buildCatalogPageQuery(filters, 40, 0);
    expect(sql).toContain("WHERE year >= ? AND year <= ?");
    expect(params).toEqual([1990, 2020, 40, 0]);
  });

  it("filters by a single source", () => {
    const filters: CatalogFilters = { sources: ["USGS"] };
    const { sql, params } = buildCatalogPageQuery(filters, 40, 0);
    expect(sql).toContain("WHERE source_catalog IN (?)");
    expect(params).toEqual(["USGS", 40, 0]);
  });

  it("filters by multiple sources", () => {
    const filters: CatalogFilters = { sources: ["USGS", "KISC", "ISCGEM"] };
    const { sql, params } = buildCatalogPageQuery(filters, 40, 0);
    expect(sql).toContain("WHERE source_catalog IN (?, ?, ?)");
    expect(params).toEqual(["USGS", "KISC", "ISCGEM", 40, 0]);
  });

  it("treats an empty sources array the same as no source filter", () => {
    const { sql, params } = buildCatalogPageQuery({ sources: [] }, 40, 0);
    expect(sql).not.toContain("WHERE");
    expect(sql).not.toContain("source_catalog IN");
    expect(params).toEqual([40, 0]);
  });

  it("combines magnitude, year, and source filters with AND, params in field order", () => {
    const filters: CatalogFilters = {
      magMin: 5.0,
      magMax: 7.0,
      yearMin: 2000,
      yearMax: 2020,
      sources: ["ONUR2017", "EMME"],
    };
    const { sql, params } = buildCatalogPageQuery(filters, 25, 50);
    expect(sql).toContain(
      "WHERE mag >= ? AND mag <= ? AND year >= ? AND year <= ? AND source_catalog IN (?, ?)",
    );
    expect(params).toEqual([5.0, 7.0, 2000, 2020, "ONUR2017", "EMME", 25, 50]);
  });

  it("puts LIMIT/OFFSET params last, after any filter params", () => {
    const { params } = buildCatalogPageQuery({ magMin: 3 }, 10, 20);
    expect(params.at(-2)).toBe(10);
    expect(params.at(-1)).toBe(20);
  });

  it("orders results newest-first", () => {
    const { sql } = buildCatalogPageQuery({}, 40, 0);
    expect(sql).toMatch(/ORDER BY t DESC/);
  });

  it("selects camelCase-aliased columns matching CatalogRow (schema v3: no `id`, `t` not `time`)", () => {
    const { sql } = buildCatalogPageQuery({}, 1, 0);
    expect(sql).toContain("t AS time");
    expect(sql).toContain("depth_km AS depthKm");
    expect(sql).toContain("mag_type AS magType");
    expect(sql).toContain("source_catalog AS sourceCatalog");
    expect(sql).toContain("source_id AS sourceId");
    expect(sql).toContain("bumelerze_id AS bumelerzeId");
    expect(sql).toContain("contributing_sources AS contributingSources");
    expect(sql).toContain("merged_count AS mergedCount");
    expect(sql).toContain("author_agency AS authorAgency");
    expect(sql).not.toMatch(/^SELECT id,/);
  });
});

describe("buildCatalogCountQuery", () => {
  it("has no WHERE clause when no filters are set", () => {
    const { sql, params } = buildCatalogCountQuery({});
    expect(sql).toBe("SELECT COUNT(*) AS count FROM events");
    expect(params).toEqual([]);
  });

  it("uses the exact same WHERE clause shape as the page query, for the same filters", () => {
    const filters: CatalogFilters = { magMin: 4, yearMax: 2010, sources: ["KISC"] };
    const page = buildCatalogPageQuery(filters, 10, 0);
    const count = buildCatalogCountQuery(filters);

    const pageWhere = page.sql.slice(page.sql.indexOf("WHERE"), page.sql.indexOf("ORDER BY"));
    const countWhere = count.sql.slice(count.sql.indexOf("WHERE"));
    expect(countWhere.trim()).toBe(pageWhere.trim());

    // Count query's params are the filter params only (no limit/offset).
    expect(count.params).toEqual([4, 2010, "KISC"]);
    expect(page.params).toEqual([4, 2010, "KISC", 10, 0]);
  });
});

describe("buildCatalogBoundsQuery", () => {
  it("selects min/max magnitude and year with no params", () => {
    const { sql, params } = buildCatalogBoundsQuery();
    expect(sql).toContain("MIN(mag) AS magMin");
    expect(sql).toContain("MAX(mag) AS magMax");
    expect(sql).toContain("MIN(year) AS yearMin");
    expect(sql).toContain("MAX(year) AS yearMax");
    expect(params).toEqual([]);
  });
});
