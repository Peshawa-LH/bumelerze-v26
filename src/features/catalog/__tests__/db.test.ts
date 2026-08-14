import { fetchCatalogBounds, fetchCatalogCount, fetchCatalogPage, type CatalogDb } from "../db";
import type { CatalogRow } from "../types";

/** A tiny fake `CatalogDb` backed by an in-memory fixture, standing in for
 * expo-sqlite's native `SQLiteDatabase` (which can't run in Jest — see
 * `db.ts`'s module doc comment). It doesn't interpret the SQL text at all;
 * it just records the last query/params it was called with and returns a
 * canned result, which is enough to prove `fetchCatalogPage`/
 * `fetchCatalogCount`/`fetchCatalogBounds` build and execute the right
 * query against whatever `CatalogDb` they're given ("db opens + query
 * helpers" test coverage, wave brief). */
function makeFakeDb(fixtureRows: CatalogRow[]): CatalogDb & {
  lastAllCall: { sql: string; params: (string | number)[] } | null;
  lastFirstCall: { sql: string; params: (string | number)[] } | null;
} {
  return {
    lastAllCall: null,
    lastFirstCall: null,
    async getAllAsync<T>(sql: string, params: (string | number)[]): Promise<T[]> {
      this.lastAllCall = { sql, params };
      return fixtureRows as unknown as T[];
    },
    async getFirstAsync<T>(sql: string, params: (string | number)[]): Promise<T | null> {
      this.lastFirstCall = { sql, params };
      if (sql.startsWith("SELECT COUNT(*)")) {
        return { count: fixtureRows.length } as unknown as T;
      }
      if (sql.includes("MIN(mag)")) {
        const mags = fixtureRows.map((r) => r.mag);
        const years = fixtureRows.map((r) => r.year);
        return {
          magMin: Math.min(...mags),
          magMax: Math.max(...mags),
          yearMin: Math.min(...years),
          yearMax: Math.max(...years),
        } as unknown as T;
      }
      return null;
    },
  };
}

const FIXTURE_ROWS: CatalogRow[] = [
  {
    id: "bumelerze-000001",
    bumelerzeId: "bml2017000s",
    time: "2017-11-12T18:18:17.180Z",
    year: 2017,
    lat: 34.9109,
    lon: 45.9592,
    depthKm: 19,
    mag: 7.3,
    magType: "mww",
    sourceCatalog: "USGS",
    sourceId: "us2000bmcg",
    contributingSources: "ONUR2017,USGS",
    mergedCount: 2,
  },
  {
    id: "bumelerze-000002",
    bumelerzeId: "bml19580002",
    time: "1958-05-05T05:21:34.000Z",
    year: 1958,
    lat: 35.644,
    lon: 44.668,
    depthKm: null,
    mag: 5.53,
    magType: "Mw",
    sourceCatalog: "ISCGEM",
    sourceId: "884317",
    contributingSources: "ISCGEM",
    mergedCount: 1,
  },
];

describe("fetchCatalogPage", () => {
  it("returns the rows the db gives back", async () => {
    const db = makeFakeDb(FIXTURE_ROWS);
    const rows = await fetchCatalogPage(db, {}, 40, 0);
    expect(rows).toEqual(FIXTURE_ROWS);
  });

  it("passes the filters/limit/offset through to the db call", async () => {
    const db = makeFakeDb(FIXTURE_ROWS);
    await fetchCatalogPage(db, { magMin: 5, sources: ["USGS"] }, 10, 20);
    expect(db.lastAllCall?.sql).toContain("mag >= ?");
    expect(db.lastAllCall?.sql).toContain("source_catalog IN (?)");
    expect(db.lastAllCall?.params).toEqual([5, "USGS", 10, 20]);
  });
});

describe("fetchCatalogCount", () => {
  it("returns the count from the db", async () => {
    const db = makeFakeDb(FIXTURE_ROWS);
    const count = await fetchCatalogCount(db, {});
    expect(count).toBe(2);
  });

  it("returns 0 when the db gives back no row at all", async () => {
    const db: CatalogDb = {
      getAllAsync: async () => [],
      getFirstAsync: async () => null,
    };
    const count = await fetchCatalogCount(db, {});
    expect(count).toBe(0);
  });
});

describe("fetchCatalogBounds", () => {
  it("reads min/max magnitude and year from the db", async () => {
    const db = makeFakeDb(FIXTURE_ROWS);
    const bounds = await fetchCatalogBounds(db);
    expect(bounds).toEqual({ magMin: 5.53, magMax: 7.3, yearMin: 1958, yearMax: 2017 });
  });

  it("falls back to a zero-width range rather than throwing when the table is empty", async () => {
    const db: CatalogDb = {
      getAllAsync: async () => [],
      getFirstAsync: async () => null,
    };
    const bounds = await fetchCatalogBounds(db);
    expect(bounds).toEqual({ magMin: 0, magMax: 0, yearMin: 0, yearMax: 0 });
  });
});
