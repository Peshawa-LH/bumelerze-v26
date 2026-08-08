import { render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n, { isRTLLocale } from "@/i18n";
import { CatalogListScreen } from "../components/CatalogListScreen";
import { formatCatalogMagnitude, formatCatalogResultsCount, formatCatalogYear } from "../format";
import type { CatalogBounds, CatalogRow } from "../types";

// Mocking `../use-catalog` (not expo-sqlite/SQLiteProvider) is the same
// "mock the data hook, test the presentational component" pattern
// `ShakeMapSection.test.tsx` uses for `useShakeMap` — no real SQLite native
// module needed in Jest, and this component doesn't need to be wrapped in
// `<SQLiteProvider>` for the test (that wiring lives in app/catalog.tsx,
// deliberately kept out of this component per its own doc comment).
jest.mock("../use-catalog", () => ({
  useCatalogBounds: jest.fn(),
  useCatalogList: jest.fn(),
}));

// eslint-disable-next-line import/first -- imported after the mock above, see comment
import { useCatalogBounds, useCatalogList } from "../use-catalog";

const mockedUseCatalogBounds = useCatalogBounds as jest.MockedFunction<typeof useCatalogBounds>;
const mockedUseCatalogList = useCatalogList as jest.MockedFunction<typeof useCatalogList>;

const BOUNDS: CatalogBounds = { magMin: 0.86, magMax: 7.7, yearMin: 872, yearMax: 2023 };

const HALABJA_ROW: CatalogRow = {
  id: "bumelerze-020659",
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

const AQRAH_ROW: CatalogRow = {
  id: "bumelerze-000042",
  time: "1991-07-24T09:45:41.000Z",
  year: 1991,
  lat: 36.52,
  lon: 44.066,
  depthKm: null,
  mag: 5.5,
  magType: "Mw",
  sourceCatalog: "EMME",
  sourceId: "1234",
  contributingSources: "EMME",
  mergedCount: 1,
};

function mockCatalog(rows: CatalogRow[], overrides: Partial<ReturnType<typeof useCatalogList>> = {}) {
  mockedUseCatalogBounds.mockReturnValue({ bounds: BOUNDS, isLoading: false, error: null });
  mockedUseCatalogList.mockReturnValue({
    rows,
    totalCount: rows.length,
    isLoading: false,
    isLoadingMore: false,
    hasMore: false,
    error: null,
    loadMore: jest.fn(),
    ...overrides,
  });
}

function renderWithProviders() {
  return render(
    <SafeAreaProvider
      initialMetrics={{ frame: { x: 0, y: 0, width: 360, height: 640 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}
    >
      <CatalogListScreen />
    </SafeAreaProvider>,
  );
}

describe("CatalogListScreen", () => {
  const originalLanguage = i18n.language;

  afterEach(async () => {
    mockedUseCatalogBounds.mockReset();
    mockedUseCatalogList.mockReset();
    await i18n.changeLanguage(originalLanguage);
  });

  it("renders rows in ckb (Sorani, RTL) with localized magnitude/year and a results count", async () => {
    expect(isRTLLocale("ckb")).toBe(true);
    await i18n.changeLanguage("ckb");
    mockCatalog([HALABJA_ROW, AQRAH_ROW]);

    await renderWithProviders();

    const t = i18n.t.bind(i18n);
    expect(screen.getByText(formatCatalogYear(2017, "ckb"))).toBeTruthy();
    expect(screen.getByText(formatCatalogMagnitude(HALABJA_ROW, "ckb", t))).toBeTruthy();
    expect(screen.getByText(formatCatalogYear(1991, "ckb"))).toBeTruthy();
    expect(screen.getByText(formatCatalogMagnitude(AQRAH_ROW, "ckb", t))).toBeTruthy();

    // Source-catalog provenance chips (untranslated codes, same across
    // locales — see i18n catalogs' `catalog.sources.*`). Appears twice each
    // (once in the filter bar's chip, once in the row's own source chip).
    expect(screen.getAllByText("USGS").length).toBeGreaterThan(0);
    expect(screen.getAllByText("EMME").length).toBeGreaterThan(0);

    // Digit-localized results count ("٢ بوومەلەرزە").
    expect(screen.getByText(formatCatalogResultsCount(2, "ckb", t))).toBeTruthy();
  });

  it("shows the empty state when no rows match the filters", async () => {
    await i18n.changeLanguage("en");
    mockCatalog([]);

    await renderWithProviders();

    expect(screen.getByText("No earthquakes match these filters.")).toBeTruthy();
  });

  it("shows a loading indicator while bounds are still loading", async () => {
    await i18n.changeLanguage("en");
    mockedUseCatalogBounds.mockReturnValue({ bounds: null, isLoading: true, error: null });
    mockedUseCatalogList.mockReturnValue({
      rows: [],
      totalCount: 0,
      isLoading: true,
      isLoadingMore: false,
      hasMore: false,
      error: null,
      loadMore: jest.fn(),
    });

    await renderWithProviders();

    expect(screen.getByLabelText("Loading catalog…")).toBeTruthy();
  });

  it("shows an error state when the catalog fails to load", async () => {
    await i18n.changeLanguage("en");
    mockedUseCatalogBounds.mockReturnValue({ bounds: null, isLoading: false, error: new Error("boom") });
    mockedUseCatalogList.mockReturnValue({
      rows: [],
      totalCount: 0,
      isLoading: false,
      isLoadingMore: false,
      hasMore: false,
      error: null,
      loadMore: jest.fn(),
    });

    await renderWithProviders();

    expect(screen.getByText("Couldn't load the catalog.")).toBeTruthy();
  });
});
