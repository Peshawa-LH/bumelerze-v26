import type { TFunction } from "i18next";

import { buildReportHtml, type ReportInput } from "./report-html";

export const canPrintReport = true;

/** `bumelerze-seismic-report_35.560N-45.430E_2026-08-31.html` — the site and
 * the date are in the name because these end up in a project folder beside
 * a dozen others, and a file called `report.html` is a file nobody can
 * identify a week later. */
function reportFileName(data: ReportInput): string {
  const ns = data.lat >= 0 ? "N" : "S";
  const ew = data.lon >= 0 ? "E" : "W";
  const day = data.generatedAt.slice(0, 10).replace(/[^0-9-]/g, "") || "report";
  return `bumelerze-seismic-report_${Math.abs(data.lat).toFixed(3)}${ns}-${Math.abs(data.lon).toFixed(3)}${ew}_${day}.html`;
}

/**
 * Saves the report as a file the engineer can keep, email or attach to a
 * submission.
 *
 * A single self-contained HTML file rather than a generated PDF: the report
 * is inline SVG throughout, and every client-side PDF library rasterises
 * that into something soft and unselectable. This file opens in any
 * browser, on any device, with no app — and printing it from there produces
 * a PDF with vector figures and selectable text, which is a better PDF than
 * a library would have made. It also survives being forwarded, which a
 * print dialog does not.
 */
export function downloadReport(data: ReportInput, t: TFunction): void {
  const blob = new Blob([buildReportHtml(data, t)], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = reportFileName(data);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoked on the next tick, not immediately: some browsers have not
  // finished reading the blob when click() returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Opens the report in its own window and calls the browser's print dialog,
 * where the engineer saves it as a PDF or sends it to paper.
 *
 * A detached window rather than printing the app page: the handbook screen
 * is a scrolling app UI with charts and controls that has no sensible print
 * layout, and a print stylesheet trying to hide all of it would be a
 * permanent maintenance tax. The report is its own document.
 */
export function printReport(data: ReportInput, t: TFunction): void {
  const html = buildReportHtml(data, t);
  const win = window.open("", "_blank");
  if (!win) {
    // Silently doing nothing would look like a broken button, so say so
    // with the only channel a detached-window failure leaves available.
    window.alert(t("handbook.report.popupBlocked"));
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  // Give the inlined SVG and fonts a tick to lay out before the dialog
  // freezes the page; printing an unstyled document is the failure mode.
  win.setTimeout(() => {
    win.focus();
    win.print();
  }, 300);
}
