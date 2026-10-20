import i18n from "@/i18n";

import { computeSpectrumParameters } from "../compute";
import {
  buildNativeReportHtml,
  canPrintReport,
  downloadReport,
  printReport,
  reportFileName,
  splitSheetIntoColumns,
} from "../print-report";
import type { ReportInput } from "../report-html";
import { findStructuralSystem } from "../structural-systems";
import type { SpectrumInputs } from "../types";

const mockPrintToFile = jest.fn();
const mockPrint = jest.fn();
jest.mock("expo-print", () => ({
  printToFileAsync: (...args: unknown[]) => mockPrintToFile(...args),
  printAsync: (...args: unknown[]) => mockPrint(...args),
}));

const mockShare = jest.fn();
let mockSharingAvailable = true;
jest.mock("expo-sharing", () => ({
  isAvailableAsync: async () => mockSharingAvailable,
  shareAsync: (...args: unknown[]) => mockShare(...args),
}));

const mockMove = jest.fn();
const mockDelete = jest.fn();
const mockMkdir = jest.fn();
let mockTargetExists = false;
jest.mock("expo-file-system", () => {
  const uriOf = (parts: unknown[]) =>
    parts.map((part) => (typeof part === "string" ? part : (part as { uri: string }).uri)).join("/");
  return {
    Paths: { cache: { uri: "file:///cache" } },
    Directory: jest.fn().mockImplementation((...parts: unknown[]) => ({
      uri: uriOf(parts),
      create: (...args: unknown[]) => mockMkdir(...args),
    })),
    File: jest.fn().mockImplementation((...parts: unknown[]) => ({
      uri: uriOf(parts),
      get exists() {
        return mockTargetExists;
      },
      delete: () => mockDelete(uriOf(parts)),
      moveSync: (target: { uri: string }) => mockMove(uriOf(parts), target.uri),
    })),
  };
});

const mockDialog = jest.fn();
jest.mock("@/lib/dialogs", () => ({
  messageDialog: (...args: unknown[]) => mockDialog(...args),
}));

const inputs: SpectrumInputs = { ss: 1.22, s1: 0.49, siteClass: "C", occupancy: "I_II", r: 4 };

function data(over: Partial<ReportInput> = {}): ReportInput {
  return {
    lat: 35.56,
    lon: 45.43,
    ss2475: 1.22,
    s12475: 0.49,
    pga2475: 0.24,
    nearestDistrict: { name: "Chamchamal", distanceKm: 44.5 },
    zone: "IV",
    vs30MS: 467,
    inputs,
    params: computeSpectrumParameters(inputs),
    system: findStructuralSystem("mf.rcSpecial"),
    heightM: 24,
    locale: "en",
    hazardSource: "isc2025",
    resolution: "interpolated",
    method: "isc",
    ec8GroundType: null,
    ag: null,
    generatedAt: "2026-08-30 09:00",
    chartSeries: [{ points: [{ t: 0, sa: 0.33 }, { t: 1, sa: 0.5 }], label: "Code spectrum" }],
    chartTMax: 4,
    ...over,
  };
}

const t = i18n.t.bind(i18n);
const PDF_NAME = "bumelerze-seismic-report_35.560N-45.430E_2026-08-30.pdf";

/** Item 23 of the iOS parity list: the phone hid both report buttons
 * (`canPrintReport = false`), so an engineer on an iPhone could not get the
 * report at all. */
describe("seismic report on the phone", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockSharingAvailable = true;
    mockTargetExists = false;
    mockPrintToFile.mockResolvedValue({ uri: "file:///cache/Print/ABC.pdf", numberOfPages: 1 });
    mockPrint.mockResolvedValue(undefined);
    mockShare.mockResolvedValue(undefined);
    await i18n.changeLanguage("en");
  });
  afterAll(() => i18n.changeLanguage("en"));

  it("offers the report", () => {
    expect(canPrintReport).toBe(true);
  });

  it("names the file like the web download, site and date included", () => {
    expect(reportFileName(data(), "pdf")).toBe(PDF_NAME);
    expect(reportFileName(data({ lat: -1.5, lon: -70.25 }), "pdf")).toBe(
      "bumelerze-seismic-report_1.500S-70.250W_2026-08-30.pdf",
    );
  });

  it("embeds Vazirmatn for Kurdish and Arabic letters and keeps the Sorani report right-to-left", async () => {
    await i18n.changeLanguage("ckb");
    const html = buildNativeReportHtml(data({ locale: "ckb" }), t);
    expect(html).toContain('<html lang="ckb" dir="rtl">');
    expect(html).toMatch(/@font-face \{ font-family: "Bumelerze Vazirmatn"; [^}]*font-weight: 400; [^}]*url\(data:font\/woff2;base64,d09GMg/);
    expect(html).toMatch(/font-weight: 700; [^}]*url\(data:font\/woff2;base64,/);
    expect(html).toContain("unicode-range: U+0600-06FF");
    // The face comes first in both stacks, after the document's own rules.
    const fontRules = html.indexOf('body, .report-page { font-family: "Bumelerze Vazirmatn"');
    expect(fontRules).toBeGreaterThan(html.indexOf("@page"));
    expect(fontRules).toBeLessThan(html.indexOf("</head>"));
    expect(html).toContain('.report-page pre { font-family: "Bumelerze Vazirmatn", ui-monospace');
    expect(html).toContain(i18n.t("handbook.report.title"));
  });

  it("lays the page out at the web's scale (the phone prints one CSS pixel per point)", () => {
    expect(buildNativeReportHtml(data(), t)).toContain("html { zoom: 0.75; }");
  });

  it("sets the parameter sheet in two blocks, as the web's two columns (print ignores CSS columns)", () => {
    const html = buildNativeReportHtml(data(), t);
    expect(html).toMatch(/<div class="sheet-columns"><pre>[\s\S]+<\/pre><pre>[\s\S]+<\/pre><\/div>/);
    expect((html.match(/<pre>/g) ?? []).length).toBe(2);
  });

  it("splits the sheet at the section break nearest its middle, and keeps every line", () => {
    const sheet = ["-- A --", "a1", "a2", "a3", "", "-- B --", "b1", "b2", "", "-- C --", "c1"];
    const out = splitSheetIntoColumns(`<body><pre>${sheet.join("\n")}</pre></body>`);
    expect(out).toBe(
      '<body><div class="sheet-columns"><pre>-- A --\na1\na2\na3</pre>' +
        "<pre>-- B --\nb1\nb2\n\n-- C --\nc1</pre></div></body>",
    );
  });

  it("splits a sheet without a section break at its middle line", () => {
    const out = splitSheetIntoColumns("<pre>1\n2\n3\n4\n5\n6</pre>");
    expect(out).toBe('<div class="sheet-columns"><pre>1\n2\n3</pre><pre>4\n5\n6</pre></div>');
  });

  it("makes an A4 PDF and hands it to the share sheet under the web's file name", async () => {
    await downloadReport(data(), t);
    const [options] = mockPrintToFile.mock.calls[0]!;
    expect(options.width).toBeCloseTo(595.28);
    expect(options.height).toBeCloseTo(841.89);
    expect(options.margins.left).toBeCloseTo(36.85, 1);
    expect(options.html).toContain("Bumelerze Vazirmatn");
    expect(mockMkdir).toHaveBeenCalledWith({ intermediates: true, idempotent: true });
    expect(mockMove).toHaveBeenCalledWith(
      "file:///cache/Print/ABC.pdf",
      `file:///cache/reports/${PDF_NAME}`,
    );
    expect(mockShare).toHaveBeenCalledWith(`file:///cache/reports/${PDF_NAME}`, {
      mimeType: "application/pdf",
      UTI: "com.adobe.pdf",
      dialogTitle: i18n.t("handbook.report.title"),
    });
    expect(mockDialog).not.toHaveBeenCalled();
  });

  it("replaces an older PDF of the same site and day", async () => {
    mockTargetExists = true;
    await downloadReport(data(), t);
    expect(mockDelete).toHaveBeenCalledWith(`file:///cache/reports/${PDF_NAME}`);
  });

  it("opens the print panel with the PDF where there is no share sheet", async () => {
    mockSharingAvailable = false;
    await downloadReport(data(), t);
    expect(mockPrint).toHaveBeenCalledWith({ uri: `file:///cache/reports/${PDF_NAME}` });
  });

  it("says so when the PDF cannot be made, never a silent button", async () => {
    mockPrintToFile.mockRejectedValue(new Error("PdfNotRendered"));
    await downloadReport(data(), t);
    expect(mockDialog).toHaveBeenCalledWith(
      "Seismic design parameters",
      "The PDF could not be made. Please try again.",
    );
  });

  it("prints through the system print panel, A4 with the report's margins", async () => {
    printReport(data(), t);
    await Promise.resolve();
    const [options] = mockPrint.mock.calls[0]!;
    expect(options.html).toContain("Bumelerze Vazirmatn");
    expect(options.width).toBeCloseTo(595.28);
    expect(options.margins.top).toBeCloseTo(36.85, 1);
  });

  it("stays quiet when the person closes the print panel", async () => {
    mockPrint.mockRejectedValue(Object.assign(new Error("Printing did not complete"), {
      code: "ERR_PRINT_INCOMPLETE",
    }));
    printReport(data(), t);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockDialog).not.toHaveBeenCalled();
  });

  it("says so when printing fails", async () => {
    mockPrint.mockRejectedValue(new Error("PdfNotRendered"));
    printReport(data(), t);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockDialog).toHaveBeenCalledTimes(1);
  });
});
