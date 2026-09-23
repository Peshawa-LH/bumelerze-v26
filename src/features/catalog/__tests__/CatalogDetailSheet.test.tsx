import { fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import { CatalogDetailSheet } from "../components/CatalogDetailSheet";
import { formatCatalogDateTimeUtc } from "../format";
import type { CatalogRow } from "../types";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const ROW: CatalogRow = {
  bumelerzeId: "bml2017000s",
  // 2017-11-12T18:18:17Z as epoch seconds (schema v3's `t` column).
  time: 1510510697,
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
  authorAgency: "us",
  region: null,
};

// Pre-1970 fixture (the catalog runs back to 872) — a negative epoch value
// is the normal, expected case here, not an edge case to guard against.
const PRE_1970_ROW: CatalogRow = {
  ...ROW,
  bumelerzeId: "bml19580002",
  time: -367958306, // 1958-05-05T05:21:34Z
  year: 1958,
};

function renderSheet(row: CatalogRow | null, onClose: () => void = jest.fn()) {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 360, height: 640 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <CatalogDetailSheet row={row} onClose={onClose} />
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

  it("converts the epoch-seconds `time` column to the correct UTC date/time (schema v3)", async () => {
    await i18n.changeLanguage("en");
    await renderSheet(ROW);

    expect(screen.getByText(formatCatalogDateTimeUtc(ROW.time, "en"))).toBeTruthy();
    expect(screen.getByText("11/12/2017 18:18:17 UTC")).toBeTruthy();
  });

  it("renders a correct date for a pre-1970 event (negative epoch seconds, not an error case)", async () => {
    await i18n.changeLanguage("en");
    await renderSheet(PRE_1970_ROW);

    expect(screen.getByText(formatCatalogDateTimeUtc(PRE_1970_ROW.time, "en"))).toBeTruthy();
    expect(screen.getByText("5/5/1958 05:21:34 UTC")).toBeTruthy();
  });
});

/** D61: the catalogue and the event database number their rows
 * independently, so a catalogue row cannot reach its own published map
 * without `published-crosswalk.ts`. */
describe("CatalogDetailSheet published-map link", () => {
  beforeEach(() => mockPush.mockClear());

  it("links to the published event when the catalogue id has a crosswalk entry", async () => {
    await i18n.changeLanguage("en");
    const onClose = jest.fn();
    await renderSheet(ROW, onClose);
    fireEvent.press(screen.getByRole("link", { name: "View shaking map" }));
    // The pushed id is the PUBLISHED one, never the catalogue's own:
    // /event/bml2017000s resolves to nothing.
    expect(mockPush).toHaveBeenCalledWith("/event/bml20170001");
    // Closed first: a modal left up over the pushed screen traps focus
    // for a screen reader.
    expect(onClose).toHaveBeenCalled();
  });

  it("shows no link for an event nothing was published for", async () => {
    await i18n.changeLanguage("en");
    // The common case by far: the catalogue holds 150,072 events and only
    // a hundred-odd carry products.
    await renderSheet({ ...ROW, bumelerzeId: "bml1899zzzz" });
    expect(screen.queryByRole("link", { name: "View shaking map" })).toBeNull();
  });

  // One test per locale rather than a loop: RNTL cleans up between tests,
  // not between renders inside one.
  it.each(["ckb", "kmr", "ar"])("offers the link in %s", async (locale) => {
    await i18n.changeLanguage(locale);
    await renderSheet(ROW);
    const label = i18n.t("catalog.detail.viewShakeMap");
    expect(label).not.toBe("catalog.detail.viewShakeMap");
    expect(screen.getByRole("link", { name: label })).toBeTruthy();
  });
});
