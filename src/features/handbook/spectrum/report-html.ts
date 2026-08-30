import type { TFunction } from "i18next";

import { buildCalculationSheet, type CalculationSheetInput } from "./calculation-sheet";
import { ec8Parameters, type Ec8GroundType } from "./ec8";
import { spectrumMethod, type SpectrumMethodId } from "./methods";
import { buildReportChartSvg, type ReportChartSeries } from "./report-chart";
import { BUMELERZE_LOGO_SVG } from "./report-logo";
import { buildReportMapSvg } from "./report-map";

/**
 * A printable one-page report: the design parameters for one site under one
 * standard, branded, with a clause on every value and the disclaimer on the
 * page rather than buried.
 *
 * WHY HTML AND THE BROWSER'S OWN PRINT
 * ------------------------------------
 * An engineer wants something they can file or hand to a checker. The
 * browser's print dialog already produces a PDF on every platform the app
 * currently ships to, so this builds a self-contained document and lets the
 * browser do the conversion. No PDF library, no native module, no dev build
 * — and the engineer keeps control of paper size and margins.
 *
 * The document is deliberately self-contained: styles inline, logo inlined
 * as SVG. It opens in a detached window with no access to the app's bundled
 * assets, and a report whose logo silently fails to load is worse than one
 * with no logo.
 *
 * WHAT THE REPORT MUST ALWAYS CARRY
 * ---------------------------------
 * The method and its return period, because the same coordinate gives
 * different answers under different standards and a printed page outlives
 * the screen that explains it; the provenance of every mapped value; and
 * the disclaimer. A page that could be mistaken for a certified design
 * document is the failure mode here, so it says what it is, twice.
 */

export interface ReportInput extends CalculationSheetInput {
  method: SpectrumMethodId;
  /** Only meaningful under Eurocode 8. */
  ec8GroundType: Ec8GroundType | null;
  /** `ag` in g, Eurocode 8 only. */
  ag: number | null;
  /** ISO timestamp, passed in so this stays pure and testable. */
  generatedAt: string;
  /** The plotted spectrum, passed in rather than recomputed so the printed
   * curve is provably the same one the engineer saw on screen. */
  chartSeries: readonly ReportChartSeries[];
  chartTMax: number;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildReportHtml(data: ReportInput, t: TFunction): string {
  const method = spectrumMethod(data.method);
  const methodName = t(`handbook.spectrum.methods.${data.method}`);
  const sheet = buildCalculationSheet(data, t);

  const ec8Row =
    data.method === "ec8" && data.ec8GroundType && data.ag !== null
      ? (() => {
          const p = ec8Parameters(data.ec8GroundType);
          return `<tr><th>${escapeHtml(t("handbook.spectrum.ec8.paramsTitle"))}</th><td>ag ${data.ag.toFixed(3)} g &middot; ${escapeHtml(data.ec8GroundType)} &middot; S ${p.s} &middot; TB ${p.tb} s &middot; TC ${p.tc} s &middot; TD ${p.td} s</td></tr>`;
        })()
      : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(t("handbook.report.title"))}</title>
<style>
  @page { size: A4; margin: 16mm; }
  /* The report is a paper document and must look like one on any screen.
   * Without this a dark-themed browser renders it black on black, which is
   * how it first appeared in review: the viewer's theme must not reach it. */
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         color: #111; background: #fff; margin: 0; font-size: 11pt; line-height: 1.45;
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  header { display: flex; align-items: center; justify-content: space-between;
           gap: 16px; border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 16px; }
  header svg { height: 34px; width: auto; }
  h1 { font-size: 15pt; margin: 0 0 2px; }
  .meta { font-size: 9pt; color: #555; text-align: right; }
  table { width: 100%; border-collapse: collapse; margin: 0 0 14px; }
  th, td { text-align: left; vertical-align: top; padding: 4px 8px 4px 0;
           border-bottom: 1px solid #e4e4e4; font-size: 10pt; }
  th { width: 38%; font-weight: 600; color: #333; }
  h2 { font-size: 11pt; margin: 16px 0 6px; text-transform: uppercase;
       letter-spacing: .04em; color: #333; }
  pre { white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 8.5pt; line-height: 1.4; background: #fafafa; border: 1px solid #e4e4e4;
        padding: 10px; border-radius: 4px; }
  .disclaimer { border: 1.5px solid #111; padding: 10px 12px; font-size: 9pt; margin-top: 16px; }
  footer { margin-top: 14px; font-size: 8pt; color: #666;
           border-top: 1px solid #e4e4e4; padding-top: 8px; }
  .figures { display: flex; gap: 14px; align-items: flex-start; margin: 4px 0 14px; }
  .figures figure { margin: 0; flex: 1 1 0; min-width: 0; }
  .figures .fig-body svg { width: 100%; height: auto; display: block; }
  .figures figcaption { font-size: 8pt; color: #555; margin-top: 4px; }
  /* Keep a figure from being split across a page break. */
  figure, table, .disclaimer { break-inside: avoid; page-break-inside: avoid; }
</style>
</head>
<body>
<header>
  <div>${BUMELERZE_LOGO_SVG}</div>
  <div class="meta">
    ${escapeHtml(t("handbook.report.generated"))}<br>${escapeHtml(data.generatedAt)}
  </div>
</header>

<h1>${escapeHtml(t("handbook.report.title"))}</h1>

<table>
  <tr><th>${escapeHtml(t("handbook.sheet.location"))}</th><td>${data.lat.toFixed(4)}, ${data.lon.toFixed(4)}</td></tr>
  ${data.nearestDistrict ? `<tr><th>${escapeHtml(t("handbook.sheet.nearestDistrict"))}</th><td>${escapeHtml(data.nearestDistrict.name)}, ${data.nearestDistrict.distanceKm.toFixed(1)} km</td></tr>` : ""}
  ${data.zone ? `<tr><th>${escapeHtml(t("handbook.sheet.zone"))}</th><td>${escapeHtml(data.zone)}</td></tr>` : ""}
  <tr><th>${escapeHtml(t("handbook.report.method"))}</th><td><strong>${escapeHtml(methodName)}</strong></td></tr>
  <tr><th>${escapeHtml(t("handbook.report.hazardBasis"))}</th><td>${escapeHtml(t("handbook.report.hazardBasisValue", { years: method.returnPeriodYears }))}</td></tr>
  ${ec8Row}
</table>

<div class="figures">
  <figure>
    <div class="fig-body">${buildReportMapSvg(data.lat, data.lon)}</div>
    <figcaption>${escapeHtml(t("handbook.report.mapCaption"))}</figcaption>
  </figure>
  <figure>
    <div class="fig-body">${buildReportChartSvg(data.chartSeries, data.chartTMax, {
      period: escapeHtml(t("handbook.report.axisPeriod")),
      acceleration: escapeHtml(t("handbook.report.axisAcceleration")),
    })}</div>
    <figcaption>${escapeHtml(t("handbook.report.chartCaption", { method: methodName }))}</figcaption>
  </figure>
</div>

<h2>${escapeHtml(t("handbook.report.parameters"))}</h2>
<pre>${escapeHtml(sheet)}</pre>

<div class="disclaimer">
  <strong>${escapeHtml(t("handbook.report.disclaimerTitle"))}</strong><br>
  ${escapeHtml(t("handbook.report.disclaimer"))}
</div>

<footer>${escapeHtml(t("handbook.report.footer"))}</footer>
</body>
</html>`;
}
