import type { TFunction } from "i18next";

import { buildCalculationSheet, type CalculationSheetInput } from "./calculation-sheet";
import { ec8Parameters, type Ec8GroundType } from "./ec8";
import { spectrumMethod, type SpectrumMethodId } from "./methods";
import {
  buildReportChartSvg,
  REPORT_CHART_ASPECT,
  type ReportChartSeries,
} from "./report-chart";
import { BUMELERZE_LOGO_SVG } from "./report-logo";
import { buildReportMapSvg, REPORT_MAP_ASPECT } from "./report-map";

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

function buildReportParts(
  data: ReportInput,
  t: TFunction,
): { styles: string; content: string } {
  const method = spectrumMethod(data.method);
  const methodName = t(`handbook.spectrum.methods.${data.method}`);
  const sheet = buildCalculationSheet(data, t, {
    includeFooter: false,
    includeSiteHeader: false,
  });

  const ec8Row =
    data.method === "ec8" && data.ec8GroundType && data.ag !== null
      ? (() => {
          const p = ec8Parameters(data.ec8GroundType);
          return `<dt>${escapeHtml(t("handbook.spectrum.ec8.paramsTitle"))}</dt><dd>ag ${data.ag.toFixed(3)} g &middot; ${escapeHtml(data.ec8GroundType)} &middot; S ${p.s} &middot; TB ${p.tb} s &middot; TC ${p.tc} s &middot; TD ${p.td} s</dd>`;
        })()
      : "";

  const styles = `  @page { size: A4; margin: 13mm; }
  /* The report is a paper document and must look like one on any screen.
   * Without this a dark-themed browser renders it black on black, which is
   * how it first appeared in review: the viewer's theme must not reach it. */
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body, .report-page { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         color: #111; background: #fff; margin: 0; font-size: 10pt; line-height: 1.4;
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .report-page header { display: flex; align-items: center; justify-content: space-between;
           gap: 16px; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 12px; }
  .report-page header svg { height: 34px; width: auto; }
  .report-page h1 { font-size: 15pt; margin: 0 0 8px; }
  .meta { font-size: 9pt; color: #555; text-align: right; }
  /* Identity on the left, the two figures on the right, one band. Stacked
   * they cost 300 px of a 1024 px page and still left the figures' row
   * half empty, because a capped figure strip cannot use the full width
   * without towering. Side by side they cost 180 px and nothing is
   * empty. */
  .topstrip { display: flex; gap: 16px; align-items: flex-start; margin: 0 0 10px; }
  .summary { flex: 1 1 0; min-width: 0; display: grid;
             grid-template-columns: auto 1fr; gap: 3px 10px; margin: 0;
             font-size: 9.5pt; align-content: start; }
  .summary dt { font-weight: 600; color: #333; }
  .summary dd { margin: 0; }
  .report-page h2 { font-size: 11pt; margin: 10px 0 5px; text-transform: uppercase;
       letter-spacing: .04em; color: #333; }
  /* The parameter sheet is ~50 short monospace lines. Down one column it
   * runs longer than the rest of the report put together and pushes the
   * page over; in two it sits beside itself and the report closes on one
   * A4 side, which is what an engineer files. */
  .report-page pre { white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 7.6pt; line-height: 1.3; background: #fafafa; border: 1px solid #e4e4e4;
        padding: 9px 10px; border-radius: 4px; margin: 0 0 10px;
        columns: 2; column-gap: 18px; column-rule: 1px solid #e8e8e8; }
  .disclaimer { border: 1.5px solid #111; padding: 8px 10px; font-size: 8.5pt;
                line-height: 1.35; margin-top: 10px; }
  .report-page footer { margin-top: 10px; font-size: 7.5pt; color: #666;
           border-top: 1px solid #e4e4e4; padding-top: 6px; }
  /* The two figures are sized so they come out the SAME HEIGHT. Left to
   * themselves at equal width, a near-square country map stands more than
   * twice as tall as a wide spectrum plot and swallows a third of the
   * page. Grow factors are the aspect ratios, so this stays correct if
   * either figure's frame is ever re-proportioned. */
  /* Capped so the pair stays a reference strip rather than the page's
   * centrepiece: the numbers are the deliverable, the figures orient you. */
  .figures { flex: 0 0 100mm; display: flex; gap: 10px;
             align-items: flex-start; margin: 0; }
  .figures figure { margin: 0; min-width: 0; flex-basis: 0; }
  .figures .fig-map { flex-grow: ${(REPORT_MAP_ASPECT * 1000).toFixed(0)}; }
  .figures .fig-chart { flex-grow: ${(REPORT_CHART_ASPECT * 1000).toFixed(0)}; }
  .figures .fig-body svg { width: 100%; height: auto; display: block; }
  .figures figcaption { font-size: 8pt; color: #555; margin-top: 4px; }
  /* Keep a figure from being split across a page break. */
  figure, .summary, .disclaimer { break-inside: avoid; page-break-inside: avoid; }
  /* The PDF path renders this same markup inside a plain div rather than
   * a document body, so the root has to carry the page's own box too. */
  .report-page { margin: 0; }`;
  const content = `<header>
  <div>${BUMELERZE_LOGO_SVG}</div>
  <div class="meta">
    ${escapeHtml(t("handbook.report.generated"))}<br>${escapeHtml(data.generatedAt)}
  </div>
</header>

<h1>${escapeHtml(t("handbook.report.title"))}</h1>

<div class="topstrip">
<dl class="summary">
  <dt>${escapeHtml(t("handbook.sheet.location"))}</dt><dd>${data.lat.toFixed(4)}, ${data.lon.toFixed(4)}</dd>
  ${data.nearestDistrict ? `<dt>${escapeHtml(t("handbook.sheet.nearestDistrict"))}</dt><dd>${escapeHtml(data.nearestDistrict.name)}, ${data.nearestDistrict.distanceKm.toFixed(1)} km</dd>` : ""}
  ${data.zone ? `<dt>${escapeHtml(t("handbook.sheet.zone"))}</dt><dd>${escapeHtml(data.zone)}</dd>` : ""}
  <dt>${escapeHtml(t("handbook.report.method"))}</dt><dd><strong>${escapeHtml(methodName)}</strong></dd>
  <dt>${escapeHtml(t("handbook.report.hazardBasis"))}</dt><dd>${escapeHtml(t("handbook.report.hazardBasisValue", { years: method.returnPeriodYears }))}</dd>
  ${ec8Row}
</dl>

<div class="figures">
  <figure class="fig-map">
    <div class="fig-body">${buildReportMapSvg(data.lat, data.lon)}</div>
    <figcaption>${escapeHtml(t("handbook.report.mapCaption"))}</figcaption>
  </figure>
  <figure class="fig-chart">
    <div class="fig-body">${buildReportChartSvg(data.chartSeries, data.chartTMax, {
      period: escapeHtml(t("handbook.report.axisPeriod")),
      acceleration: escapeHtml(t("handbook.report.axisAcceleration")),
    })}</div>
    <figcaption>${escapeHtml(t("handbook.report.chartCaption", { method: methodName }))}</figcaption>
  </figure>
</div>
</div>

<h2>${escapeHtml(t("handbook.report.parameters"))}</h2>
<pre>${escapeHtml(sheet)}</pre>

<div class="disclaimer">
  <strong>${escapeHtml(t("handbook.report.disclaimerTitle"))}</strong><br>
  ${escapeHtml(t("handbook.report.disclaimer"))}
</div>

<footer>${escapeHtml(t("handbook.report.footer"))}</footer>`;

  return { styles, content };

}

/** The standalone document: what the engineer downloads as HTML and what
 * the print path opens in its own window. */
export function buildReportHtml(data: ReportInput, t: TFunction): string {
  const { styles, content } = buildReportParts(data, t);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(t("handbook.report.title"))}</title>
<style>
${styles}
</style>
</head>
<body>
${content}
</body>
</html>`;
}

/**
 * The same report as a fragment, for the PDF rasteriser.
 *
 * Not a string of the whole document: the rasteriser draws this inside an
 * `<svg><foreignObject>`, which takes an XHTML subtree rather than a
 * document, and `<body>` rules would not apply to it. Hence
 * `.report-page`, which every rule in `styles` also names.
 */
export function buildReportFragment(
  data: ReportInput,
  t: TFunction,
): { styles: string; content: string } {
  return buildReportParts(data, t);
}
