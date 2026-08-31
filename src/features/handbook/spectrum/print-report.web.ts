import type { TFunction } from "i18next";

import { buildReportHtml, type ReportInput } from "./report-html";
import { buildReportPdf } from "./report-raster.web";

export const canPrintReport = true;

/** `bumelerze-seismic-report_35.560N-45.430E_2026-08-31.pdf` — the site and
 * the date are in the name because these end up in a project folder beside
 * a dozen others, and a file called `report.pdf` is a file nobody can
 * identify a week later. */
function reportFileName(data: ReportInput, extension: "pdf" | "html"): string {
  const ns = data.lat >= 0 ? "N" : "S";
  const ew = data.lon >= 0 ? "E" : "W";
  const day = data.generatedAt.slice(0, 10).replace(/[^0-9-]/g, "") || "report";
  return `bumelerze-seismic-report_${Math.abs(data.lat).toFixed(3)}${ns}-${Math.abs(data.lon).toFixed(3)}${ew}_${day}.${extension}`;
}

function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoked on a later tick, not immediately: some browsers have not
  // finished reading the blob when click() returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Saves the report as a PDF the engineer can keep, email or attach to a
 * submission.
 *
 * The page is rasterised by the browser and wrapped in a PDF rather than
 * typeset by a PDF library, because no JS library shapes Arabic script:
 * see `report-raster.web.ts`. The cost is that the text is pixels rather
 * than selectable glyphs, which is why the HTML report stays on offer
 * beside it for anyone who needs live text.
 *
 * If anything in that path fails — an old browser, a blocked canvas — the
 * HTML file is saved instead, and the engineer is told, because silently
 * handing over a different format than the button promised is exactly the
 * bug this replaced.
 */
export async function downloadReport(data: ReportInput, t: TFunction): Promise<void> {
  try {
    const pdf = await buildReportPdf(data, t);
    saveBlob(new Blob([pdf as BlobPart], { type: "application/pdf" }), reportFileName(data, "pdf"));
  } catch {
    saveBlob(
      new Blob([buildReportHtml(data, t)], { type: "text/html;charset=utf-8" }),
      reportFileName(data, "html"),
    );
    window.alert(t("handbook.report.pdfFailed"));
  }
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
