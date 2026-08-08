import { fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n, { isRTLLocale } from "@/i18n";
import { HandbookScreen } from "../components/HandbookScreen";

// Same "mock the data hook" pattern the other handbook component tests use —
// no real expo-location native module needed in Jest.
jest.mock("@/features/location", () => ({
  useUserDistanceAnchor: jest.fn(() => ({ hasFix: false, lat: null, lon: null })),
}));

function renderWithProviders() {
  return render(
    <SafeAreaProvider
      initialMetrics={{ frame: { x: 0, y: 0, width: 360, height: 640 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}
    >
      <HandbookScreen />
    </SafeAreaProvider>,
  );
}

describe("HandbookScreen", () => {
  const originalLanguage = i18n.language;

  afterEach(async () => {
    await i18n.changeLanguage(originalLanguage);
  });

  it("renders the intro, form, and disclaimer in ckb (Sorani, RTL) before any lookup", async () => {
    expect(isRTLLocale("ckb")).toBe(true);
    await i18n.changeLanguage("ckb");

    await renderWithProviders();

    expect(screen.getByText(i18n.t("handbook.intro"))).toBeTruthy();
    expect(screen.getByLabelText(i18n.t("handbook.coordinates.latLabel"))).toBeTruthy();
    expect(screen.getByLabelText(i18n.t("handbook.coordinates.lonLabel"))).toBeTruthy();
    expect(screen.getByText(i18n.t("handbook.disclaimer"))).toBeTruthy();
    // No results table until a lookup is submitted.
    expect(screen.queryByText(i18n.t("handbook.rows.pga.label"))).toBeNull();
  });

  it("runs a real lookup end-to-end in ckb and shows digit-localized, cited results for a real Kurdistan coordinate", async () => {
    await i18n.changeLanguage("ckb");
    await renderWithProviders();

    await fireEvent.changeText(screen.getByLabelText(i18n.t("handbook.coordinates.latLabel")), "35.56");
    await fireEvent.changeText(screen.getByLabelText(i18n.t("handbook.coordinates.lonLabel")), "45.43");
    await fireEvent.press(screen.getByText(i18n.t("handbook.lookupButton")));

    // Sulaimani falls inside a PGA zone and has Vs30 coverage + nearby soil
    // points — every cited row should now be present.
    expect(screen.getByText(i18n.t("handbook.rows.pga.citation"))).toBeTruthy();
    expect(screen.getByText(i18n.t("handbook.rows.siteClass.citation"))).toBeTruthy();
    expect(screen.getByText(i18n.t("handbook.rows.soil.citation"))).toBeTruthy();
  });

  it("shows the honest outside-coverage state end-to-end for a coordinate far outside Iraq (Paris)", async () => {
    await i18n.changeLanguage("en");
    await renderWithProviders();

    await fireEvent.changeText(screen.getByLabelText("Latitude"), "48.8566");
    await fireEvent.changeText(screen.getByLabelText("Longitude"), "2.3522");
    await fireEvent.press(screen.getByText("Look up"));

    expect(screen.getByText("No bundled data covers this location.")).toBeTruthy();
    expect(
      screen.getByText("This location is outside the Iraqi Seismic Code 2017 zonation map."),
    ).toBeTruthy();
    expect(screen.getByText("No Vs30 data at this location.")).toBeTruthy();
    expect(screen.queryByText("Nearby Sulaimani soil/site points")).toBeNull();
  });
});
