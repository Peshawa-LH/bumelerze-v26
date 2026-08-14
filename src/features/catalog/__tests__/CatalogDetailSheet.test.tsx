import { render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import { CatalogDetailSheet } from "../components/CatalogDetailSheet";
import type { CatalogRow } from "../types";

const ROW: CatalogRow = {
  id: "bumelerze-020659",
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
};

function renderSheet(row: CatalogRow | null) {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 360, height: 640 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <CatalogDetailSheet row={row} onClose={jest.fn()} />
    </SafeAreaProvider>,
  );
}

describe("CatalogDetailSheet", () => {
  const originalLanguage = i18n.language;

  afterEach(async () => {
    await i18n.changeLanguage(originalLanguage);
  });

  it("shows the bml id row (the ONLY place the app surfaces bml ids)", async () => {
    await i18n.changeLanguage("en");
    await renderSheet(ROW);

    expect(screen.getByText("Bumelerze ID")).toBeTruthy();
    expect(screen.getByText("bml2017000s")).toBeTruthy();
    // Still alongside the provider-id provenance row, not replacing it.
    expect(screen.getByText("Source ID")).toBeTruthy();
    expect(screen.getByText("us2000bmcg")).toBeTruthy();
  });

  it("labels the bml id row in Sorani under ckb", async () => {
    await i18n.changeLanguage("ckb");
    await renderSheet(ROW);

    expect(screen.getByText("ژمارەی بوومەلەرزە")).toBeTruthy();
    // The id value itself stays Latin/untranslated (an identifier).
    expect(screen.getByText("bml2017000s")).toBeTruthy();
  });
});
