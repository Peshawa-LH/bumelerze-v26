import { render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import { HandbookResultTable } from "../components/HandbookResultTable";
import { formatNearbySoilSummary, formatNearestSoilPoint } from "../format";
import type { HandbookLookupResult } from "../types";

const NEAREST_POINT = {
  point: {
    id: "SP10-RC878-2022",
    method: "hvsr" as const,
    lat: 35.5763,
    lon: 45.4196,
    ec8: "C",
    nehrp: "D",
    vs30EstimateMS: 467,
  },
  distanceKm: 1.9,
};

const SECOND_POINT = {
  point: {
    id: "SP11-RB89E-2022",
    method: "borehole" as const,
    lat: 35.5681,
    lon: 45.4133,
    ec8: "B",
    nehrp: "C",
    vs30EstimateMS: null,
  },
  distanceKm: 5.2,
};

const FULL_RESULT: HandbookLookupResult = {
  lat: 35.56,
  lon: 45.43,
  pgaZone: { zone: "V", pgaG: 0.5, ring: [] },
  vs30MS: 467,
  vs30Citation: "Index of /pub/srtm30_plus. Retrieved February 8, 2023 from https://topex.ucsd.edu/pub/srtm30_plus/",
  siteClass: { ec8: "B", nehrp: "C" },
  nearbySoilPoints: [NEAREST_POINT, SECOND_POINT],
};

const OUT_OF_COVERAGE_RESULT: HandbookLookupResult = {
  lat: 48.8566,
  lon: 2.3522,
  pgaZone: null,
  vs30MS: null,
  vs30Citation: FULL_RESULT.vs30Citation,
  siteClass: null,
  nearbySoilPoints: [],
};

describe("HandbookResultTable", () => {
  const originalLanguage = i18n.language;

  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  afterEach(async () => {
    await i18n.changeLanguage(originalLanguage);
  });

  it("shows every populated row with its own citation, as a compact table (owner feedback 2026-08-21)", async () => {
    await render(<HandbookResultTable result={FULL_RESULT} />);

    // PGA row + citation.
    expect(screen.getByText("Design PGA")).toBeTruthy();
    expect(screen.getByText("Iraqi Seismic Code 2017, design-PGA zonation map")).toBeTruthy();

    // Vs30 row: caveat sublabel + citation (the verbatim source citation
    // string) — the exact rounded numeral is covered by format.test.ts,
    // not duplicated here.
    expect(screen.getByText("Vs30")).toBeTruthy();
    expect(screen.getByText("Global topographic-slope model, not a site measurement")).toBeTruthy();
    expect(screen.getByText(FULL_RESULT.vs30Citation)).toBeTruthy();

    // Site-class row: EC8 only, no NEHRP anywhere in the row.
    expect(screen.getByText("Site class")).toBeTruthy();
    expect(screen.getByText("EC8 B")).toBeTruthy();
    expect(screen.getByText("Eurocode 8 (EN 1998-1) Table 3.1")).toBeTruthy();
    expect(screen.queryByText(/NEHRP/)).toBeNull();

    // Soil section: one summarized row (nearest point), not a per-point
    // list — the whole point of this fix.
    expect(screen.getByText("Nearest measured soil/site point")).toBeTruthy();
    expect(
      screen.getByText(formatNearbySoilSummary(FULL_RESULT.nearbySoilPoints.length, "en", i18n.t)),
    ).toBeTruthy();
    expect(
      screen.getByText(formatNearestSoilPoint(NEAREST_POINT, "en", i18n.t)),
    ).toBeTruthy();
    // The second (farther) point is folded into the count, not rendered
    // as its own card.
    expect(screen.queryByText(/SP11-RB89E-2022/)).toBeNull();
    expect(
      screen.getByText(
        "Sulaimani soil/site investigation, 2024 (Peshawa L. Hasan, DAAD-Iraq / KISC field campaign)",
      ),
    ).toBeTruthy();

    // GMPE transparency row + its note.
    expect(screen.getByText("Ground-motion models used in this app")).toBeTruthy();
    expect(screen.getByText("CY14, ASB14, BSSA14, Kale15-Iran")).toBeTruthy();
  });

  it("shows the honest outside-zonation / unavailable states and hides the soil section entirely when out of coverage", async () => {
    await render(<HandbookResultTable result={OUT_OF_COVERAGE_RESULT} />);

    expect(
      screen.getByText("This location is outside the Iraqi Seismic Code 2017 zonation map."),
    ).toBeTruthy();
    expect(screen.getByText("No Vs30 data at this location.")).toBeTruthy();
    expect(screen.queryByText("Site class")).toBeNull();
    expect(screen.queryByText("Nearest measured soil/site point")).toBeNull();

    // The GMPE row is static and still shown even with nothing else covered.
    expect(screen.getByText("Ground-motion models used in this app")).toBeTruthy();

    // Overarching "nothing covers this" message.
    expect(screen.getByText("No bundled data covers this location.")).toBeTruthy();
  });
});
