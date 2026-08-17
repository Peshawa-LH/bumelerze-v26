import {
  computeDataUsedSummaryKey,
  extractEngineVersion,
  parseLiveShakeMapProductRows,
  selectLatestLiveProductRow,
  type LiveShakeMapProductRow,
} from "../live-types";

function validRow(overrides: Record<string, unknown> = {}) {
  return {
    version: 2,
    storage_path: "https://example.test/events/us2000bmcg/v2/cont_mi.json",
    data_used: { conditioning_applied: { ems: true }, instrument_stations_parsed: 4 },
    review_status: "automatic",
    reviewed_by: null,
    reviewed_at: null,
    created_at: "2026-08-18T00:00:00.000Z",
    ...overrides,
  };
}

describe("parseLiveShakeMapProductRows", () => {
  it("parses a well-formed row", () => {
    const { rows, skippedCount } = parseLiveShakeMapProductRows([validRow()]);
    expect(rows).toHaveLength(1);
    expect(skippedCount).toBe(0);
    expect(rows[0]?.version).toBe(2);
  });

  it("tolerantly drops a malformed row and counts it, keeping the good ones", () => {
    const { rows, skippedCount } = parseLiveShakeMapProductRows([
      validRow(),
      { not: "a valid row" },
      validRow({ version: 3, review_status: "not-a-real-status" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(skippedCount).toBe(2);
  });

  it("returns an empty result for a non-array payload", () => {
    expect(parseLiveShakeMapProductRows(null)).toEqual({ rows: [], skippedCount: 0 });
    expect(parseLiveShakeMapProductRows(undefined)).toEqual({ rows: [], skippedCount: 0 });
    expect(parseLiveShakeMapProductRows({})).toEqual({ rows: [], skippedCount: 0 });
  });

  it("rejects a row missing a required field (e.g. no storage_path)", () => {
    const row = validRow();
    delete (row as Record<string, unknown>).storage_path;
    const { rows, skippedCount } = parseLiveShakeMapProductRows([row]);
    expect(rows).toHaveLength(0);
    expect(skippedCount).toBe(1);
  });
});

describe("selectLatestLiveProductRow", () => {
  function row(overrides: Partial<LiveShakeMapProductRow>): LiveShakeMapProductRow {
    return {
      version: 1,
      storage_path: "x",
      data_used: {},
      review_status: "automatic",
      reviewed_by: null,
      reviewed_at: null,
      created_at: "2026-08-18T00:00:00.000Z",
      ...overrides,
    };
  }

  it("returns null for an empty row list", () => {
    expect(selectLatestLiveProductRow([])).toBeNull();
  });

  it("picks the highest version number as the newest product", () => {
    const chosen = selectLatestLiveProductRow([
      row({ version: 1 }),
      row({ version: 3 }),
      row({ version: 2 }),
    ]);
    expect(chosen?.version).toBe(3);
  });

  it("prefers a reviewed row over an automatic one at the same version (defensive tiebreak)", () => {
    const chosen = selectLatestLiveProductRow([
      row({ version: 2, review_status: "automatic" }),
      row({ version: 2, review_status: "reviewed" }),
    ]);
    expect(chosen?.review_status).toBe("reviewed");
  });
});

describe("computeDataUsedSummaryKey", () => {
  it("returns catalogOnly when no conditioning was applied", () => {
    expect(
      computeDataUsedSummaryKey({ conditioning_applied: { ems: false, mmi: false } }),
    ).toBe("catalogOnly");
  });

  it("returns catalogOnly when conditioning_applied is missing entirely", () => {
    expect(computeDataUsedSummaryKey({})).toBe("catalogOnly");
  });

  it("returns catalogOnly for a non-object payload (defensive)", () => {
    expect(computeDataUsedSummaryKey(null)).toBe("catalogOnly");
    expect(computeDataUsedSummaryKey("nonsense")).toBe("catalogOnly");
  });

  it("returns stationConditioned when only station data was used", () => {
    expect(
      computeDataUsedSummaryKey({
        conditioning_applied: { ems: true },
        instrument_stations_parsed: 5,
        dyfi_boxes_parsed: 0,
      }),
    ).toBe("stationConditioned");
  });

  it("returns dyfiConditioned when only felt-report data was used", () => {
    expect(
      computeDataUsedSummaryKey({
        conditioning_applied: { ems: true },
        instrument_stations_parsed: 0,
        dyfi_boxes_parsed: 12,
      }),
    ).toBe("dyfiConditioned");
  });

  it("returns stationAndDyfiConditioned when both were used", () => {
    expect(
      computeDataUsedSummaryKey({
        conditioning_applied: { ems: true },
        instrument_stations_parsed: 5,
        dyfi_boxes_parsed: 12,
      }),
    ).toBe("stationAndDyfiConditioned");
  });

  it("is honest about the small-N floor: conditioning_applied all-false stays catalogOnly even with raw counts present", () => {
    expect(
      computeDataUsedSummaryKey({
        conditioning_applied: { ems: false },
        instrument_stations_parsed: 2,
        dyfi_boxes_parsed: 1,
      }),
    ).toBe("catalogOnly");
  });
});

describe("extractEngineVersion", () => {
  it("extracts a full engine_version block", () => {
    const result = extractEngineVersion({
      engine_version: {
        service_version: "0.1.0",
        gsim_branches: "CY14,ASB14,BSSA14,KALE15",
        ems_model: "Zaniniandhofer19",
        mmi_model: "WordenEtAl12",
        conditioning: "mvn (Engler et al. 2022)",
      },
    });
    expect(result).toEqual({
      serviceVersion: "0.1.0",
      gsimBranches: "CY14,ASB14,BSSA14,KALE15",
      emsModel: "Zaniniandhofer19",
      mmiModel: "WordenEtAl12",
      conditioning: "mvn (Engler et al. 2022)",
    });
  });

  it("returns null when engine_version is absent", () => {
    expect(extractEngineVersion({})).toBeNull();
  });

  it("returns null for a malformed engine_version (wrong types)", () => {
    expect(extractEngineVersion({ engine_version: { service_version: 123 } })).toBeNull();
  });

  it("returns null for a non-object data_used payload", () => {
    expect(extractEngineVersion(null)).toBeNull();
    expect(extractEngineVersion("nonsense")).toBeNull();
  });

  it("returns null when engine_version is present but every field is empty", () => {
    expect(extractEngineVersion({ engine_version: {} })).toBeNull();
  });
});
