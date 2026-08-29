import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";

import i18n, { isRTLLocale } from "@/i18n";
import { SpectrumSection } from "../components/SpectrumSection";

// Sulaimani-ish Vs30 that lands in the ISC D band (180-370 m/s) — matches
// the median-grid case the design doc's §3.6 calls out.
const VS30_D_BAND = 250;

describe("SpectrumSection", () => {
  const originalLanguage = i18n.language;

  afterEach(async () => {
    if (i18n.language !== originalLanguage) {
      await i18n.changeLanguage(originalLanguage);
    }
    jest.restoreAllMocks();
  });

  it("shows the form and the honesty banner, but no chart/table, before Ss/S1 are entered", async () => {
    await i18n.changeLanguage("en");
    await render(<SpectrumSection vs30MS={VS30_D_BAND} locale="en" />);

    expect(screen.getByText(i18n.t("handbook.spectrum.sectionTitle"))).toBeTruthy();
    expect(screen.getByText(i18n.t("handbook.spectrum.banner.notOfRecord"))).toBeTruthy();
    expect(screen.getByLabelText(i18n.t("handbook.spectrum.ssLabel"))).toBeTruthy();
    expect(screen.queryByText(i18n.t("handbook.spectrum.table.title"))).toBeNull();
  });

  it("pre-fills the site class from the derived Vs30-based ISC class (D for 250 m/s)", async () => {
    await i18n.changeLanguage("en");
    await render(<SpectrumSection vs30MS={VS30_D_BAND} locale="en" />);

    expect(
      screen.getByText(i18n.t("handbook.spectrum.siteClassDerivedNote", { siteClass: "D" })),
    ).toBeTruthy();
  });

  it("reproduces the ISC-2017 Appendix B Baghdad example end-to-end once Ss/S1 are typed in", async () => {
    await i18n.changeLanguage("en");
    await render(<SpectrumSection vs30MS={VS30_D_BAND} locale="en" />);

    await fireEvent.changeText(screen.getByLabelText(i18n.t("handbook.spectrum.ssLabel")), "0.3");
    await fireEvent.changeText(screen.getByLabelText(i18n.t("handbook.spectrum.s1Label")), "0.1");
    // Site class D is already pre-filled from vs30MS=250; R=4 is the
    // default verified chip value; occupancy defaults to I/II (I=1.0).

    expect(screen.getByText(i18n.t("handbook.spectrum.table.title"))).toBeTruthy();
    // SDS = 0.312 g, SD1 = 0.16 g, per Appendix B (compute.test.ts verifies
    // the numeric chain; this checks the table actually renders them).
    expect(screen.getAllByText(/0\.312/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/0\.160/).length).toBeGreaterThan(0);
    // Seismic design category C, per Appendix B.
    expect(screen.getByText("C")).toBeTruthy();
  });

  it("copies the control-point table to the clipboard", async () => {
    await i18n.changeLanguage("en");
    const setStringSpy = jest.spyOn(Clipboard, "setStringAsync").mockResolvedValue(true);
    await render(<SpectrumSection vs30MS={VS30_D_BAND} locale="en" />);

    await fireEvent.changeText(screen.getByLabelText(i18n.t("handbook.spectrum.ssLabel")), "0.3");
    await fireEvent.changeText(screen.getByLabelText(i18n.t("handbook.spectrum.s1Label")), "0.1");

    await fireEvent.press(screen.getByText(i18n.t("handbook.spectrum.table.copy")));

    await waitFor(() => expect(setStringSpy).toHaveBeenCalledTimes(1));
    const copiedText = setStringSpy.mock.calls[0]?.[0] ?? "";
    expect(copiedText).toContain("SDS");
    expect(copiedText).toContain("0.312");
  });

  it("lets the engineer override the derived site class, and offers a reset back to it", async () => {
    await i18n.changeLanguage("en");
    await render(<SpectrumSection vs30MS={VS30_D_BAND} locale="en" />);

    await fireEvent.press(screen.getByLabelText(i18n.t("handbook.spectrum.siteClassOptionA11y", { siteClass: "C" })));

    expect(
      screen.getByText(i18n.t("handbook.spectrum.resetSiteClass", { siteClass: "D" })),
    ).toBeTruthy();
  });

  it("renders end-to-end in ckb (Sorani, RTL) with no crash and shows the notation symbols untranslated", async () => {
    expect(isRTLLocale("ckb")).toBe(true);
    await i18n.changeLanguage("ckb");
    await render(<SpectrumSection vs30MS={VS30_D_BAND} locale="ckb" />);

    await fireEvent.changeText(screen.getByLabelText(i18n.t("handbook.spectrum.ssLabel")), "0.3");
    await fireEvent.changeText(screen.getByLabelText(i18n.t("handbook.spectrum.s1Label")), "0.1");

    expect(screen.getByText(i18n.t("handbook.spectrum.table.title"))).toBeTruthy();
    // SDS/SD1/T0/Ts/R are notation — never translated, in any locale.
    expect(screen.getByText("SDS")).toBeTruthy();
    expect(screen.getByText("SD1")).toBeTruthy();
    expect(screen.getByText("T0")).toBeTruthy();
  });

  it("measures and draws the SVG chart once its container reports a nonzero layout width", async () => {
    await i18n.changeLanguage("en");
    await render(<SpectrumSection vs30MS={VS30_D_BAND} locale="en" />);

    await fireEvent.changeText(screen.getByLabelText(i18n.t("handbook.spectrum.ssLabel")), "0.3");
    await fireEvent.changeText(screen.getByLabelText(i18n.t("handbook.spectrum.s1Label")), "0.1");

    expect(screen.queryByTestId("spectrum-code-curve")).toBeNull();

    const container = screen.getByTestId("spectrum-chart-container");
    await fireEvent(container, "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 240 } } });

    expect(screen.getByTestId("spectrum-code-curve")).toBeTruthy();
    expect(screen.getByTestId("spectrum-reduced-curve")).toBeTruthy();
  });
});
