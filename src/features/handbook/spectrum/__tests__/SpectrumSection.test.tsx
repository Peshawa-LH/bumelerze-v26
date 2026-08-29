import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";

import i18n, { isRTLLocale } from "@/i18n";
import type { Isc2025Result } from "../../types";
import { SpectrumSection } from "../components/SpectrumSection";

// Sulaimani-ish Vs30 that lands in the ISC D band (180-370 m/s) — matches
// the median-grid case the design doc's §3.6 calls out.
const VS30_D_BAND = 250;

/** Most cases below exercise hand-entered Ss/S1, so they pass a coordinate
 * the code does not cover and the form opens empty — the behaviour these
 * tests were written against. The pre-fill path has its own cases at the
 * end. */
const NO_ISC2025: Isc2025Result = { values: null, zone: null, nearestDistrict: null };

const DERBENDIKHAN: Isc2025Result = {
  values: {
    ss2475: 1.25,
    s12475: 0.5,
    pga2475: 0.25,
    ss1000: 0.81,
    s11000: 0.32,
    pga1000: 0.16,
  },
  zone: { zone: "IV", ssMinG: 0.95, ssMaxG: 1.35, ring: [] },
  nearestDistrict: {
    district: {
      id: "18.4",
      nameEn: "Derbendikhan",
      nameAr: "دربندیخان",
      governorate: "Sulaymaniyah",
      lat: 35.196,
      lon: 45.733,
      ss2475G: 1.25,
      s12475G: 0.5,
      ss1000G: 0.81,
      s11000G: 0.32,
      pga2475G: 0.25,
      pga1000G: 0.16,
      zone: "IV",
    },
    distanceKm: 12.4,
  },
};

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
    await render(<SpectrumSection vs30MS={VS30_D_BAND} isc2025={NO_ISC2025} locale="en" />);

    expect(screen.getByText(i18n.t("handbook.spectrum.sectionTitle"))).toBeTruthy();
    expect(screen.getByText(i18n.t("handbook.spectrum.banner.notOfRecord"))).toBeTruthy();
    expect(screen.getByLabelText(i18n.t("handbook.spectrum.ssLabel"))).toBeTruthy();
    expect(screen.queryByText(i18n.t("handbook.spectrum.table.title"))).toBeNull();
  });

  it("pre-fills the site class from the derived Vs30-based ISC class (D for 250 m/s)", async () => {
    await i18n.changeLanguage("en");
    await render(<SpectrumSection vs30MS={VS30_D_BAND} isc2025={NO_ISC2025} locale="en" />);

    expect(
      screen.getByText(i18n.t("handbook.spectrum.siteClassDerivedNote", { siteClass: "D" })),
    ).toBeTruthy();
  });

  it("reproduces the ISC-2017 Appendix B Baghdad example end-to-end once Ss/S1 are typed in", async () => {
    await i18n.changeLanguage("en");
    await render(<SpectrumSection vs30MS={VS30_D_BAND} isc2025={NO_ISC2025} locale="en" />);

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
    await render(<SpectrumSection vs30MS={VS30_D_BAND} isc2025={NO_ISC2025} locale="en" />);

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
    await render(<SpectrumSection vs30MS={VS30_D_BAND} isc2025={NO_ISC2025} locale="en" />);

    await fireEvent.press(screen.getByLabelText(i18n.t("handbook.spectrum.siteClassOptionA11y", { siteClass: "C" })));

    expect(
      screen.getByText(i18n.t("handbook.spectrum.resetSiteClass", { siteClass: "D" })),
    ).toBeTruthy();
  });

  it("renders end-to-end in ckb (Sorani, RTL) with no crash and shows the notation symbols untranslated", async () => {
    expect(isRTLLocale("ckb")).toBe(true);
    await i18n.changeLanguage("ckb");
    await render(<SpectrumSection vs30MS={VS30_D_BAND} isc2025={NO_ISC2025} locale="ckb" />);

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
    await render(<SpectrumSection vs30MS={VS30_D_BAND} isc2025={NO_ISC2025} locale="en" />);

    await fireEvent.changeText(screen.getByLabelText(i18n.t("handbook.spectrum.ssLabel")), "0.3");
    await fireEvent.changeText(screen.getByLabelText(i18n.t("handbook.spectrum.s1Label")), "0.1");

    expect(screen.queryByTestId("spectrum-code-curve")).toBeNull();

    const container = screen.getByTestId("spectrum-chart-container");
    await fireEvent(container, "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 240 } } });

    expect(screen.getByTestId("spectrum-code-curve")).toBeTruthy();
    expect(screen.getByTestId("spectrum-reduced-curve")).toBeTruthy();
  });
});

describe("SpectrumSection pre-filled from the Iraqi Seismic Code 2025", () => {
  const originalLanguage = i18n.language;

  afterEach(async () => {
    if (i18n.language !== originalLanguage) {
      await i18n.changeLanguage(originalLanguage);
    }
  });

  it("computes a spectrum immediately, with no typing at all", async () => {
    await i18n.changeLanguage("en");
    await render(
      <SpectrumSection vs30MS={VS30_D_BAND} isc2025={DERBENDIKHAN} locale="en" />,
    );

    // The whole point of the change: opening the handbook on a coordinate
    // now yields a spectrum, where before it yielded an empty form.
    expect(screen.getByText(i18n.t("handbook.spectrum.table.title"))).toBeTruthy();
    // Ss 1.25 / S1 0.50, site class D, R 4, occupancy I/II.
    // SDS = (2/3) * Fa * Ss with Fa = 1.0 at Ss >= 1.25 -> 0.833
    expect(screen.getAllByText(/0\.833/).length).toBeGreaterThan(0);
  });

  it("names the district and distance the values came from", async () => {
    await i18n.changeLanguage("en");
    await render(
      <SpectrumSection vs30MS={VS30_D_BAND} isc2025={DERBENDIKHAN} locale="en" />,
    );

    expect(screen.getByText(/Derbendikhan/)).toBeTruthy();
  });

  it("offers a restore once the engineer overrides a code value", async () => {
    await i18n.changeLanguage("en");
    await render(
      <SpectrumSection vs30MS={VS30_D_BAND} isc2025={DERBENDIKHAN} locale="en" />,
    );

    expect(screen.queryByText(i18n.t("handbook.spectrum.codeValues.reset"))).toBeNull();

    await fireEvent.changeText(screen.getByLabelText(i18n.t("handbook.spectrum.ssLabel")), "0.3");

    const reset = screen.getByText(i18n.t("handbook.spectrum.codeValues.reset"));
    expect(reset).toBeTruthy();

    await fireEvent.press(reset);
    expect(screen.queryByText(i18n.t("handbook.spectrum.codeValues.reset"))).toBeNull();
  });

  it("leaves the form empty where the code has no coverage", async () => {
    await i18n.changeLanguage("en");
    await render(
      <SpectrumSection vs30MS={VS30_D_BAND} isc2025={NO_ISC2025} locale="en" />,
    );

    expect(screen.queryByText(i18n.t("handbook.spectrum.table.title"))).toBeNull();
    expect(screen.getByText(i18n.t("handbook.spectrum.banner.ssS1Source"))).toBeTruthy();
  });

  it("renders the pre-filled path in ckb (Sorani, RTL) without crashing", async () => {
    await i18n.changeLanguage("ckb");
    await render(
      <SpectrumSection vs30MS={VS30_D_BAND} isc2025={DERBENDIKHAN} locale="ckb" />,
    );

    expect(screen.getByText(i18n.t("handbook.spectrum.table.title"))).toBeTruthy();
    expect(screen.getByText("SDS")).toBeTruthy();
  });
});
