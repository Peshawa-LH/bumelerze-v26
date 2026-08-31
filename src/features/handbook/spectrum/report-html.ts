import type { TFunction } from "i18next";

import { buildCalculationSheet, type CalculationSheetInput } from "./calculation-sheet";
import { ec8Parameters, type Ec8GroundType } from "./ec8";
import { isRTLLocale } from "@/i18n";
import { formatFixedLocalized, localizeDigits } from "@/lib/format-numbers";

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
  /**
   * The locale the report is written in. Passed in rather than read off
   * `t`: the document needs `lang` and `dir` on its root element, and a
   * Sorani report laid out left-to-right is a Kurdish document in an
   * English frame -- labels on the wrong side, the logo on the wrong side,
   * and the reading order fighting the script.
   */
  locale: string;
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

/**
 * Wraps a run in `<bdi>`, which isolates it from the surrounding
 * direction.
 *
 * The summary block's numerals are localized, unlike the calculation
 * sheet's -- see the note on the sheet in `calculation-sheet.ts`. The
 * sheet is a machine-readable artifact bound for a spreadsheet; this
 * block is the report's own prose, sitting beside a sentence that already
 * writes its year in Eastern digits, and it reads as the app does.
 *
 * Without this the right-to-left report reordered its own data: the
 * timestamp "2026-08-31 20:00" came out as "20:00 2026-08-31", and the
 * coordinate pair "35.5600, 45.4300" came out latitude-last. Both are two
 * neutral-separated numeric runs, which the bidi algorithm is entitled to
 * lay out right to left -- and on a seismic report a silently transposed
 * coordinate is the worst possible defect.
 */
function bdi(value: string): string {
  return `<bdi>${escapeHtml(value)}</bdi>`;
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
          return `<dt>${escapeHtml(t("handbook.spectrum.ec8.paramsTitle"))}</dt><dd>${bdi(`ag ${data.ag.toFixed(3)} g \u00b7 ${data.ec8GroundType} \u00b7 S ${p.s} \u00b7 TB ${p.tb} s \u00b7 TC ${p.tc} s \u00b7 TD ${p.td} s`)}</dd>`;
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
  .meta { font-size: 9pt; color: #555; text-align: end; }
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
  /* The sheet stays left-to-right in every locale. It is column-aligned
   * plain text whose numerals are deliberately ASCII (see
   * calculation-sheet.ts): flipping it would break the alignment that
   * makes it readable and pasteable, while the bidi algorithm still lays
   * out each Kurdish or Arabic run inside a line correctly. This is the
   * same treatment a terminal gives mixed-script output. */
  .report-page pre { direction: ltr; text-align: left;
        white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
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
  /* The root carries this class in BOTH paths: on <body> in the
   * standalone document and on the wrapper div the PDF rasteriser draws.
   * Every rule below that names an element also names this class, so the
   * two render identically -- when the class was on the div only, the
   * document lost the logo size and the sheet's columns. */
  .report-page { margin: 0; }`;
  const content = `<header>
  <div>${BUMELERZE_LOGO_SVG}</div>
  <div class="meta">
    ${escapeHtml(t("handbook.report.generated"))}<br>${bdi(data.generatedAt)}
  </div>
</header>

<h1>${escapeHtml(t("handbook.report.title"))}</h1>

<div class="topstrip">
<dl class="summary">
  <dt>${escapeHtml(t("handbook.sheet.location"))}</dt><dd>${bdi(`${formatFixedLocalized(data.lat, 4, data.locale)}, ${formatFixedLocalized(data.lon, 4, data.locale)}`)}</dd>
  ${data.nearestDistrict ? `<dt>${escapeHtml(t("handbook.sheet.nearestDistrict"))}</dt><dd>${escapeHtml(
            t("handbook.report.districtValue", {
              district: data.nearestDistrict.name,
              distance: formatFixedLocalized(data.nearestDistrict.distanceKm, 1, data.locale),
            }),
          )}</dd>` : ""}
  ${data.zone ? `<dt>${escapeHtml(t("handbook.sheet.zone"))}</dt><dd>${bdi(data.zone)}</dd>` : ""}
  <dt>${escapeHtml(t("handbook.report.method"))}</dt><dd><strong>${escapeHtml(methodName)}</strong></dd>
  <dt>${escapeHtml(t("handbook.report.hazardBasis"))}</dt><dd>${escapeHtml(t("handbook.report.hazardBasisValue", { years: localizeDigits(String(method.returnPeriodYears), data.locale) }))}</dd>
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
  const dir = isRTLLocale(data.locale) ? "rtl" : "ltr";
  return `<!doctype html>
<html lang="${escapeHtml(data.locale)}" dir="${dir}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(t("handbook.report.title"))}</title>
<style>
${styles}
</style>
</head>
<body class="report-page">
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
): { styles: string; content: string; dir: "rtl" | "ltr"; lang: string } {
  return {
    ...buildReportParts(data, t),
    dir: isRTLLocale(data.locale) ? "rtl" : "ltr",
    lang: data.locale,
  };
}
