import type { TFunction } from "i18next";

import { buildReportHtml, type ReportInput } from "./report-html";

export const canPrintReport = true;

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
    // Popup blocked. Silently doing nothing would look like a broken
    // button, so say so with the only channel a detached-window failure
    // leaves available.
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
