import { render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import { HandbookResultTable } from "../components/HandbookResultTable";
import type { HandbookLookupResult } from "../types";

const FULL_RESULT: HandbookLookupResult = {
  lat: 35.56,
  lon: 45.43,
  pgaZone: { zone: "V", pgaG: 0.5, ring: [] },
  vs30MS: 467,
  vs30Citation: "Index of /pub/srtm30_plus. Retrieved February 8, 2023 from https://topex.ucsd.edu/pub/srtm30_plus/",
  siteClass: { ec8: "B", nehrp: "C" },
  nearbySoilPoints: [
    {
      point: {
        id: "SP10-RC878-2022",
        method: "hvsr",
        lat: 35.5763,
        lon: 45.4196,
        ec8: "C",
        nehrp: "D",
        vs30EstimateMS: 467,
      },
      distanceKm: 1.9,
    },
  ],
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

  it("shows every populated row with its own citation", async () => {
    await render(<HandbookResultTable result={FULL_RESULT} />);

    // PGA row + citation.
    expect(screen.getByText("Design PGA")).toBeTruthy();
    expect(screen.getByText("Iraqi Seismic Code 2017, design-PGA zonation map")).toBeTruthy();

    // Vs30 row + citation (the verbatim source citation string).
    expect(screen.getByText("Vs30")).toBeTruthy();
    expect(screen.getByText(FULL_RESULT.vs30Citation)).toBeTruthy();

    // Site-class row + citation.
    expect(screen.getByText("Site class")).toBeTruthy();
    expect(
      screen.getByText("Eurocode 8 (EN 1998-1) Table 3.1; NEHRP site classes (ASCE 7-16 Table 20.3-1)"),
    ).toBeTruthy();

    // Soil section + its shared citation.
    expect(screen.getByText("Nearby Sulaimani soil/site points")).toBeTruthy();
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
    expect(screen.queryByText("Nearby Sulaimani soil/site points")).toBeNull();

    // The GMPE row is static and still shown even with nothing else covered.
    expect(screen.getByText("Ground-motion models used in this app")).toBeTruthy();

    // Overarching "nothing covers this" message.
    expect(screen.getByText("No bundled data covers this location.")).toBeTruthy();
  });
});
