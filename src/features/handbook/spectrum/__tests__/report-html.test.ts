import i18n from "@/i18n";

import { computeSpectrumParameters } from "../compute";
import { buildReportHtml, type ReportInput } from "../report-html";
import { findStructuralSystem } from "../structural-systems";
import type { SpectrumInputs } from "../types";

const inputs: SpectrumInputs = { ss: 1.22, s1: 0.49, siteClass: "C", occupancy: "I_II", r: 4 };
const params = computeSpectrumParameters(inputs);

function report(over: Partial<ReportInput> = {}): string {
  return buildReportHtml(
    {
      lat: 35.56, lon: 45.43,
      ss2475: 1.22, s12475: 0.49, pga2475: 0.24,
      nearestDistrict: { name: "Chamchamal", distanceKm: 44.5 },
      zone: "IV",
      vs30MS: 467,
      inputs, params,
      system: findStructuralSystem("mf.rcSpecial"),
      heightM: 24,
      method: "isc",
      ec8GroundType: null,
      ag: null,
      generatedAt: "2026-08-30 09:00",
      ...over,
    },
    i18n.t.bind(i18n),
  );
}

describe("buildReportHtml", () => {
  const original = i18n.language;
  beforeEach(async () => { await i18n.changeLanguage("en"); });
  afterEach(async () => { await i18n.changeLanguage(original); });

  it("is a self-contained document with the logo inlined", () => {
    const html = report();
    expect(html.startsWith("<!doctype html>")).toBe(true);
    // No external requests: the report window has no access to app assets.
    expect(html).not.toMatch(/<link[^>]+href=/);
    expect(html).not.toMatch(/<script/);
    expect(html).toContain("<svg");
    expect(html).toContain("viewBox=\"0 0 1800 360\"");
  });

  it("always names the method and the hazard basis", () => {
    // A printed page outlives the screen that explained it, so the standard
    // and the return period must be on the paper.
    const isc = report({ method: "isc" });
    expect(isc).toContain(i18n.t("handbook.spectrum.methods.isc"));
    expect(isc).toContain("2475");

    const ec8 = report({ method: "ec8", ec8GroundType: "B", ag: 0.15 });
    expect(ec8).toContain(i18n.t("handbook.spectrum.methods.ec8"));
    expect(ec8).toContain("1000");
  });

  it("carries the Eurocode 8 parameters only under Eurocode 8", () => {
    expect(report({ method: "ec8", ec8GroundType: "B", ag: 0.15 })).toContain("TB 0.15 s");
    expect(report({ method: "isc" })).not.toContain("TB 0.15 s");
  });

  it("always carries the disclaimer", () => {
    const html = report();
    expect(html).toContain(i18n.t("handbook.report.disclaimerTitle"));
    expect(html).toContain(i18n.t("handbook.report.disclaimer"));
  });

  it("states that the values are forthcoming-edition and preliminary", () => {
    const html = report();
    expect(html).toMatch(/forthcoming/i);
    expect(html).toMatch(/not a design document/i);
  });

  it("includes the full calculation sheet with its clause references", () => {
    const html = report();
    expect(html).toContain("ISC-2017 T2-2/1(a)");
    expect(html).toContain("ISC-2017 T3-2/1");
    expect(html).toContain("Chamchamal");
  });

  it("escapes text so a district name can never inject markup", () => {
    const html = report({ nearestDistrict: { name: '<script>x</script>', distanceKm: 1 } });
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders in a right-to-left locale without losing the disclaimer", async () => {
    await i18n.changeLanguage("ckb");
    const html = report();
    expect(html).toContain(i18n.t("handbook.report.disclaimer"));
    expect(html).toContain("<svg");
  });
});
