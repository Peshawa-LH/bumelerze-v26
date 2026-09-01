import damageContoursFixture from "../__fixtures__/us6000jllz/cont_damage.trimmed.json";
import districtsFixture from "../__fixtures__/us6000jllz/districts.json";
import riskSummaryFixture from "../__fixtures__/us6000jllz/risk_summary.json";
import { ATLAS_BASE_URL } from "../config";
import {
  buildBundledReportUrl,
  parseDamageContours,
  parseRiskDistricts,
  parseRiskProduct,
  parseRiskSummary,
} from "../risk";

describe("parseRiskSummary", () => {
  it("parses the real (trimmed) us6000jllz risk_summary.json", () => {
    const summary = parseRiskSummary(riskSummaryFixture);

    expect(summary).not.toBeNull();
    expect(summary?.stage).toBe("pga_lognormal");
    expect(summary?.timeOfDay).toBe("night");
    expect(summary?.nDraws).toBe(200);
    expect(summary?.buildingsHeavy).toBe(136378);
    expect(summary?.buildingsHeavyP05P50P95).toEqual([116423, 158965, 209051]);
    expect(summary?.exposedPopulation).toBe(17079988);
    expect(summary?.casualtiesPublished).toBe(false);
    expect(summary?.exposure.buildingsInGrid).toBe(1953862);
    expect(summary?.exposure.countries).toEqual(["Iraq", "Turkey"]);
    expect(summary?.hazardVersionConditioning).toContain("Engler et al. 2022");
  });

  it("returns null (never throws) for a missing/malformed payload", () => {
    expect(parseRiskSummary(undefined)).toBeNull();
    expect(parseRiskSummary(null)).toBeNull();
    expect(parseRiskSummary({})).toBeNull();
    expect(parseRiskSummary({ stage: "pga_lognormal" })).toBeNull();
  });

  it("never carries a fatality/injury field even if the payload had one — RiskSummary has no slot for it", () => {
    const summary = parseRiskSummary({
      ...riskSummaryFixture,
      // A hypothetical future field — must be silently dropped, not
      // surfaced anywhere on the parsed result (D45).
      fatalities_p05_p50_p95: [1, 2, 3],
    });

    expect(summary).not.toBeNull();
    expect(summary).not.toHaveProperty("fatalities_p05_p50_p95");
    expect(summary).not.toHaveProperty("fatalitiesP05P50P95");
  });

  it("defaults hazardVersionConditioning to null when the source product doesn't carry it", () => {
    const { hazard_version: _omit, ...withoutHazardVersion } = riskSummaryFixture as Record<
      string,
      unknown
    >;
    const summary = parseRiskSummary(withoutHazardVersion);

    expect(summary?.hazardVersionConditioning).toBeNull();
  });
});

describe("parseRiskDistricts", () => {
  it("parses the real (trimmed) us6000jllz districts.json, preserving worst-first order", () => {
    const districts = parseRiskDistricts(districtsFixture);

    expect(districts).not.toBeNull();
    expect(districts?.skippedCount).toBe(0);
    expect(districts?.districts).toHaveLength(10);
    expect(districts?.districts[0]?.adm1Name).toBe("HATAY");
    expect(districts?.districts[0]?.buildingsHeavyP05P50P95).toEqual([34291, 43414, 53933]);
    expect(districts?.districts[0]?.exposedPopulation).toBe(1311929);
    // Worst-first: the producer's own order is preserved, never re-sorted
    // — the first row's P50 heavy-building count must be >= the second's.
    const [first, second] = districts?.districts ?? [];
    expect(first!.buildingsHeavy).toBeGreaterThanOrEqual(second!.buildingsHeavy);
  });

  it("returns null for a top-level shape that isn't the expected object", () => {
    expect(parseRiskDistricts(undefined)).toBeNull();
    expect(parseRiskDistricts([])).toBeNull();
    expect(parseRiskDistricts({ districts: "not-an-array" })).toBeNull();
  });

  it("skips one malformed district row and keeps the rest (tolerant per-item parsing)", () => {
    const withOneBadRow = {
      ...districtsFixture,
      districts: [
        ...(districtsFixture as { districts: unknown[] }).districts,
        { adm1_id: "XX-00" /* missing every other required field */ },
      ],
    };

    const districts = parseRiskDistricts(withOneBadRow);

    expect(districts).not.toBeNull();
    expect(districts?.skippedCount).toBe(1);
    expect(districts?.districts).toHaveLength(10);
  });
});

describe("parseDamageContours", () => {
  it("parses the real (trimmed) us6000jllz cont_damage.json into 6 levels, ascending", () => {
    const damage = parseDamageContours(damageContoursFixture);

    expect(damage).not.toBeNull();
    expect(damage?.skippedCount).toBe(0);
    expect(damage?.levels).toHaveLength(6);
    expect(damage?.levels.map((level) => level.value)).toEqual([0.5, 1.0, 1.5, 2.0, 2.5, 3.0]);
  });

  it("maps each value to the DG ramp index (1..5), clamped and rounded", () => {
    const damage = parseDamageContours(damageContoursFixture);
    const levelsByValue = new Map(damage?.levels.map((level) => [level.value, level.level]));

    expect(levelsByValue.get(0.5)).toBe(1);
    expect(levelsByValue.get(1.0)).toBe(1);
    expect(levelsByValue.get(1.5)).toBe(2);
    expect(levelsByValue.get(2.0)).toBe(2);
    expect(levelsByValue.get(2.5)).toBe(3);
    expect(levelsByValue.get(3.0)).toBe(3);
  });

  it("returns null (never throws) for a malformed/missing payload — optional artifact", () => {
    expect(parseDamageContours(undefined)).toBeNull();
    expect(parseDamageContours(null)).toBeNull();
    expect(parseDamageContours({ type: "NotAFeatureCollection" })).toBeNull();
  });

  it("keeps real ring point data intact for the highest level", () => {
    const damage = parseDamageContours(damageContoursFixture);
    const highest = damage?.levels[damage.levels.length - 1];

    expect(highest?.value).toBe(3.0);
    expect(highest?.rings.length).toBeGreaterThan(0);
    expect(highest?.rings[0]?.points.length).toBeGreaterThan(0);
  });
});

describe("parseRiskProduct", () => {
  const rawProduct = {
    summary: riskSummaryFixture,
    districts: districtsFixture,
    damageContours: damageContoursFixture,
  };

  it("parses a full bundled-shaped risk payload into a RiskProduct", () => {
    const product = parseRiskProduct(rawProduct);

    expect(product).not.toBeNull();
    expect(product?.summary.buildingsHeavy).toBe(136378);
    expect(product?.districts.districts).toHaveLength(10);
    expect(product?.damageContours?.levels).toHaveLength(6);
  });

  it("returns a product with damageContours null when the artifact is absent (optional)", () => {
    const product = parseRiskProduct({
      summary: riskSummaryFixture,
      districts: districtsFixture,
    });

    expect(product).not.toBeNull();
    expect(product?.damageContours).toBeNull();
  });

  it("returns null (whole product absent) when summary is missing — summary and districts are both required", () => {
    const product = parseRiskProduct({ districts: districtsFixture });

    expect(product).toBeNull();
  });

  it("returns null (whole product absent) when districts is missing", () => {
    const product = parseRiskProduct({ summary: riskSummaryFixture });

    expect(product).toBeNull();
  });

  it("returns null for a non-object raw value (undefined, null, array, primitive)", () => {
    expect(parseRiskProduct(undefined)).toBeNull();
    expect(parseRiskProduct(null)).toBeNull();
    expect(parseRiskProduct([])).toBeNull();
    expect(parseRiskProduct("not-an-object")).toBeNull();
  });

  it("carries a real reportUrl through when the raw payload has one", () => {
    const product = parseRiskProduct({ ...rawProduct, reportUrl: "https://example.test/report.pdf" });

    expect(product?.reportUrl).toBe("https://example.test/report.pdf");
  });

  it("defaults reportUrl to null when the raw payload has none (never fabricated)", () => {
    const product = parseRiskProduct(rawProduct);

    expect(product?.reportUrl).toBeNull();
  });

  it("defaults reportUrl to null for a malformed (non-string) reportUrl value", () => {
    const product = parseRiskProduct({ ...rawProduct, reportUrl: 12345 });

    expect(product?.reportUrl).toBeNull();
  });
});

describe("buildBundledReportUrl", () => {
  it("derives the deterministic per-version Atlas report path", () => {
    expect(buildBundledReportUrl("us6000jllz", 5)).toBe(
      `${ATLAS_BASE_URL}/events/us6000jllz/v5/report.pdf`,
    );
  });
});
