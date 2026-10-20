import { Directory, File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import type { TFunction } from "i18next";

import {
  VAZIRMATN_BOLD_WOFF2_BASE64,
  VAZIRMATN_REGULAR_WOFF2_BASE64,
} from "@/features/share/share-font-data";
import { messageDialog } from "@/lib/dialogs";

import { buildReportHtml, type ReportInput } from "./report-html";

/**
 * Phone (iOS and Android) twin of `print-report.web.ts`; same exports.
 *
 * The phone's own web engine (WKWebView on iOS) lays the report HTML out,
 * shapes Sorani and Arabic correctly, and writes a real PDF with live,
 * selectable text and vector figures (`expo-print`). "Download" hands that
 * file to the share sheet (Save to Files, Mail, AirDrop, Print); "Print"
 * opens the system print panel with its preview.
 */
export const canPrintReport = true;

/** A4 in PDF points (1/72 inch), the paper the web report is laid out for. */
const A4_PAGE = { width: 595.28, height: 841.89 } as const;
/** The web report's `@page { margin: 13mm }`, in points. A phone's print
 * engine sets the page from these options, not from the CSS. */
const PAGE_MARGIN_PT = (13 / 25.4) * 72;
const PAGE_OPTIONS = {
  ...A4_PAGE,
  margins: {
    top: PAGE_MARGIN_PT,
    right: PAGE_MARGIN_PT,
    bottom: PAGE_MARGIN_PT,
    left: PAGE_MARGIN_PT,
  },
} as const;

/** The folder in the cache that keeps the last PDFs made for sharing. */
const REPORTS_FOLDER = "reports";

/**
 * `bumelerze-seismic-report_35.560N-45.430E_2026-08-31.pdf`, the same name
 * the web download uses (`print-report.web.ts`): the site and the date are
 * in the name because these end up in a project folder beside a dozen
 * others.
 */
export function reportFileName(data: ReportInput, extension: "pdf" | "html"): string {
  const ns = data.lat >= 0 ? "N" : "S";
  const ew = data.lon >= 0 ? "E" : "W";
  const day = data.generatedAt.slice(0, 10).replace(/[^0-9-]/g, "") || "report";
  return `bumelerze-seismic-report_${Math.abs(data.lat).toFixed(3)}${ns}-${Math.abs(data.lon).toFixed(3)}${ew}_${day}.${extension}`;
}

/** The phone's print engine lays a page out at one CSS pixel per point,
 * where a browser uses 96 pixels per inch (0.75 pt). Without this the text
 * came out a third larger than the web's PDF. */
const PRINT_ZOOM = 0.75;

/** Arabic-script code points, the ones the embedded Vazirmatn face serves. */
const ARABIC_SCRIPT_RANGE =
  "U+0600-06FF, U+0750-077F, U+08A0-08FF, U+FB50-FDFF, U+FE70-FEFF";
const ARABIC_SCRIPT_FAMILY = "Bumelerze Vazirmatn";
const SYSTEM_FONTS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const MONO_FONTS = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/**
 * The phone-only styles: Vazirmatn for every Kurdish and Arabic letter, the
 * web's page scale, and the parameter sheet's two columns.
 *
 * Vazirmatn is embedded for every Kurdish and Arabic letter. The
 * phone's system face lacks the Kurdish letter forms (ە ڵ ێ ۆ ڕ) and swaps
 * them in mid-word from another font, which is the "writing doesn't align"
 * the owner saw in the app. The face is limited to Arabic script, so Latin
 * text keeps the system face exactly as on the web, and it comes first in
 * every stack, the column-aligned parameter sheet included.
 */
export function reportFontStyles(): string {
  const face = (weight: 400 | 700, base64: string) =>
    `@font-face { font-family: "${ARABIC_SCRIPT_FAMILY}"; font-style: normal; font-weight: ${weight}; ` +
    `src: url(data:font/woff2;base64,${base64}) format("woff2"); unicode-range: ${ARABIC_SCRIPT_RANGE}; }`;
  return [
    face(400, VAZIRMATN_REGULAR_WOFF2_BASE64),
    face(700, VAZIRMATN_BOLD_WOFF2_BASE64),
    `body, .report-page { font-family: "${ARABIC_SCRIPT_FAMILY}", ${SYSTEM_FONTS}; }`,
    `.report-page pre { font-family: "${ARABIC_SCRIPT_FAMILY}", ${MONO_FONTS}; }`,
    `html { zoom: ${PRINT_ZOOM}; }`,
    // Two blocks side by side stand in for the sheet's CSS columns (see
    // `splitSheetIntoColumns`); each block is one plain column.
    `.sheet-columns { display: flex; gap: 18px; direction: ltr; align-items: flex-start; }`,
    `.sheet-columns pre { flex: 1 1 0; min-width: 0; columns: auto; }`,
  ].join("\n");
}

/**
 * The parameter sheet as two `<pre>` blocks side by side, split at the
 * section break nearest its middle.
 *
 * The web sets the sheet in two CSS columns so the report closes on one A4
 * side. The phone's print engine (WebKit's print layout) ignores CSS
 * columns: the sheet ran down one long column and the footer fell onto a
 * second page (checked on the iOS Simulator, 2026-10-21). A sheet without a
 * section break near its middle is split at its middle line.
 */
export function splitSheetIntoColumns(html: string): string {
  return html.replace(/<pre>([\s\S]*?)<\/pre>/, (whole, body: string) => {
    const lines = body.split("\n");
    if (lines.length < 4) {
      return whole;
    }
    const middle = lines.length / 2;
    // The section break nearest the middle, if one lies within a quarter of
    // the sheet of it; otherwise the middle line itself.
    let cut = Math.round(middle);
    let best = lines.length / 4;
    lines.forEach((line, index) => {
      const distance = Math.abs(index - middle);
      if (line.trim() === "" && distance <= best) {
        cut = index;
        best = distance;
      }
    });
    const first = lines.slice(0, cut).join("\n").replace(/\n+$/, "");
    const second = lines.slice(cut).join("\n").replace(/^\n+/, "");
    return `<div class="sheet-columns"><pre>${first}</pre><pre>${second}</pre></div>`;
  });
}

/** The web report's document, laid out for the phone's print engine: the
 * phone-only styles come last, so they win over the document's own. */
export function buildNativeReportHtml(data: ReportInput, t: TFunction): string {
  const html = splitSheetIntoColumns(buildReportHtml(data, t));
  return html.replace("</head>", `<style>\n${reportFontStyles()}\n</style>\n</head>`);
}

function sayFailed(t: TFunction): void {
  messageDialog(t("handbook.report.title"), t("handbook.report.pdfFailedNative"));
}

/** `expo-print` rejects with this code when the person closes the print
 * panel without printing; that is a choice, not a failure. */
function isPrintCancel(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  const message = (error as { message?: unknown } | null)?.message;
  return (
    code === "ERR_PRINT_INCOMPLETE" ||
    (typeof message === "string" && message.includes("did not complete"))
  );
}

/**
 * Makes the PDF and opens the share sheet with it, under the same file name
 * as the web download. Says so in a dialog if the PDF could not be made.
 */
export async function downloadReport(data: ReportInput, t: TFunction): Promise<void> {
  try {
    const { uri } = await Print.printToFileAsync({
      html: buildNativeReportHtml(data, t),
      ...PAGE_OPTIONS,
    });
    const folder = new Directory(Paths.cache, REPORTS_FOLDER);
    folder.create({ intermediates: true, idempotent: true });
    const target = new File(folder, reportFileName(data, "pdf"));
    if (target.exists) {
      target.delete();
    }
    new File(uri).moveSync(target);
    if (!(await Sharing.isAvailableAsync())) {
      // No share sheet: the system print panel can still save or print it.
      await Print.printAsync({ uri: target.uri });
      return;
    }
    await Sharing.shareAsync(target.uri, {
      mimeType: "application/pdf",
      UTI: "com.adobe.pdf",
      dialogTitle: t("handbook.report.title"),
    });
  } catch (error) {
    if (!isPrintCancel(error)) {
      sayFailed(t);
    }
  }
}

/**
 * Opens the system print panel (with its page preview) for the report:
 * paper, or "Save to Files" from the panel's share button.
 */
export function printReport(data: ReportInput, t: TFunction): void {
  void Print.printAsync({ html: buildNativeReportHtml(data, t), ...PAGE_OPTIONS }).catch(
    (error: unknown) => {
      if (!isPrintCancel(error)) {
        sayFailed(t);
      }
    },
  );
}
