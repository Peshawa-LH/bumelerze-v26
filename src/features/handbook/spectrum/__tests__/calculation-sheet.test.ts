import i18n from "@/i18n";

import { buildCalculationSheet } from "../calculation-sheet";
import { computeSpectrumParameters } from "../compute";
import { seismicLoadEffects, SEISMIC_LOAD_COMBINATIONS } from "../load-effects";
import { findStructuralSystem } from "../structural-systems";
import type { SpectrumInputs } from "../types";

const inputs: SpectrumInputs = {
  ss: 1.22, s1: 0.49, siteClass: "C", occupancy: "I_II", r: 6.5,
};
const params = computeSpectrumParameters(inputs);

function sheet(over: Partial<Parameters<typeof buildCalculationSheet>[0]> = {}) {
  return buildCalculationSheet(
    {
      lat: 35.56, lon: 45.43,
      ss2475: 1.22, s12475: 0.49, pga2475: 0.24,
      nearestDistrict: { name: "Chamchamal", distanceKm: 44.5 },
      zone: "IV",
      vs30MS: 467,
      inputs, params,
      system: findStructuralSystem("mf.rcSpecial"),
      heightM: 24,
      ...over,
    },
    i18n.t.bind(i18n),
  );
}

describe("buildCalculationSheet", () => {
  const original = i18n.language;
  beforeEach(async () => { await i18n.changeLanguage("en"); });
  afterEach(async () => { await i18n.changeLanguage(original); });

  it("carries a clause reference on every value line", () => {
    const text = sheet();
    // Every line naming a code quantity must cite where it came from,
    // because a reviewer has to be able to check it without asking.
    for (const key of ["Fa", "Fv", "SDS", "SD1", "R", "Omega0", "Cd", "Ta", "Cu", "Cs"]) {
      const line = text.split("\n").find((l) => l.startsWith(`${key}:`));
      expect(line).toBeDefined();
      expect(line).toMatch(/\[.+\]/);
    }
  });

  it("names the site and its provenance", () => {
    const text = sheet();
    expect(text).toContain("35.5600, 45.4300");
    expect(text).toContain("Chamchamal");
    expect(text).toContain("44.5 km");
  });

  it("uses ASCII numerals even in a right-to-left locale", async () => {
    // The sheet is destined for a spreadsheet or report, so Eastern
    // Arabic-Indic digits would be a liability. Opposite of the screen rule.
    await i18n.changeLanguage("ckb");
    const text = sheet();
    expect(text).toContain("35.5600, 45.4300");
    expect(text).not.toMatch(/[٠-٩۰-۹]\d*\.\d/);
  });

  it("substitutes the real vertical seismic coefficient", () => {
    const text = sheet();
    const effects = seismicLoadEffects(params.sds, 3);
    expect(effects.verticalTermOmitted).toBe(false);
    expect(text).toContain(effects.verticalCoefficient.toFixed(3));
    expect(text).toContain("rho x QE");
  });

  it("drops the vertical term where SDS <= 0.125, as the code requires", () => {
    const lowInputs: SpectrumInputs = { ...inputs, ss: 0.1, s1: 0.04 };
    const lowParams = computeSpectrumParameters(lowInputs);
    expect(lowParams.sds).toBeLessThanOrEqual(0.125);
    const text = sheet({ inputs: lowInputs, params: lowParams });
    expect(text).toContain(i18n.t("handbook.sheet.verticalOmitted"));
  });

  it("leaves rho to the engineer rather than inventing one", () => {
    const text = sheet();
    expect(text).toContain("rho");
    expect(text).toContain(i18n.t("handbook.sheet.rhoNote"));
  });

  it("lists only the combinations that contain E", () => {
    const text = sheet();
    for (const c of SEISMIC_LOAD_COMBINATIONS) {
      expect(text).toContain(c.expression);
    }
    // Gravity-only combinations are deliberately absent.
    expect(text).not.toContain("1.4(D+F)");
  });

  it("still produces a sheet with no system chosen", () => {
    const text = sheet({ system: null, heightM: null });
    expect(text).toContain("SDS");
    expect(text).not.toContain("Omega0:");
  });

  it("always ends with the preliminary-use warning", () => {
    expect(sheet().trim().endsWith(i18n.t("handbook.sheet.footer"))).toBe(true);
  });
});
