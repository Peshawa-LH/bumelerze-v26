import { A4_HEIGHT_PT, A4_WIDTH_PT, buildPdf, type PdfPageImage } from "../report-pdf";

/**
 * The PDF container is written by hand, so the thing worth testing is the
 * file format itself rather than any behaviour: a viewer finds every object
 * through the cross-reference table, and an offset that is wrong by one
 * byte produces a file that looks fine here and opens nowhere.
 *
 * So these tests read the xref back the way a viewer would and check each
 * entry lands on the object it claims. Image bytes are deliberately chosen
 * to include 0x00 and 0x0a, which is what breaks an implementation that
 * assembles the file as a string.
 */

function page(overrides: Partial<PdfPageImage> = {}): PdfPageImage {
  return {
    data: new Uint8Array([0xff, 0x00, 0x0a, 0x25, 0x50, 0x44, 0x46, 0xd8]),
    width: 4,
    height: 6,
    filter: "FlateDecode",
    ...overrides,
  };
}

function ascii(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

/** Byte offsets from the file's own xref table, in object order. */
function xrefOffsets(bytes: Uint8Array): number[] {
  const text = ascii(bytes);
  // "\nxref\n", not "xref\n": the trailer's own `startxref` keyword
  // contains the shorter string and sits after the table.
  const start = text.lastIndexOf("\nxref\n");
  const entries = text
    .slice(start)
    .match(/^(\d{10}) \d{5} [nf] $/gm);
  return (entries ?? []).map((line) => Number(line.slice(0, 10)));
}

describe("buildPdf", () => {
  it("refuses to write a document with no pages", () => {
    expect(() => buildPdf([])).toThrow(/at least one page/);
  });

  it("writes a PDF header and trailer", () => {
    const text = ascii(buildPdf([page()]));
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("/Root 1 0 R");
  });

  it("points every xref entry at the object it indexes", () => {
    const bytes = buildPdf([page(), page()]);
    const text = ascii(bytes);
    const offsets = xrefOffsets(bytes);
    // Entry 0 is the mandatory free object; 1..n are real.
    expect(offsets).toHaveLength(3 + 2 * 3);
    offsets.slice(1).forEach((offset, index) => {
      expect(text.slice(offset, offset + 12)).toMatch(new RegExp(`^${index + 1} 0 obj`));
    });
  });

  it("declares the size the trailer and the table agree on", () => {
    const bytes = buildPdf([page(), page(), page()]);
    const text = ascii(bytes);
    const declared = Number(/\/Size (\d+)/.exec(text)![1]);
    expect(declared).toBe(3 + 3 * 3);
    expect(xrefOffsets(bytes)).toHaveLength(declared);
    expect(text).toContain("/Count 3");
  });

  it("keeps image bytes intact, including nulls and newlines", () => {
    const data = new Uint8Array([0x00, 0x0a, 0x0d, 0xff, 0x80, 0x00]);
    const bytes = buildPdf([page({ data })]);
    const text = ascii(bytes);
    const at = text.indexOf("stream\n") + "stream\n".length;
    expect(Array.from(bytes.slice(at, at + data.length))).toEqual(Array.from(data));
    expect(text).toContain(`/Length ${data.length}`);
  });

  it("sizes every page to A4 and fills it with the image", () => {
    const text = ascii(buildPdf([page()]));
    expect(text).toContain(`/MediaBox [0 0 ${A4_WIDTH_PT} ${A4_HEIGHT_PT}]`);
    expect(text).toContain(`${A4_WIDTH_PT} 0 0 ${A4_HEIGHT_PT} 0 0 cm`);
    expect(text).toContain("/Im0 Do");
  });

  it("carries each page's own dimensions and filter", () => {
    const text = ascii(
      buildPdf([
        page({ width: 100, height: 200, filter: "FlateDecode" }),
        page({ width: 300, height: 400, filter: "DCTDecode" }),
      ]),
    );
    expect(text).toContain("/Width 100 /Height 200");
    expect(text).toContain("/Width 300 /Height 400");
    expect(text).toContain("/Filter /FlateDecode");
    expect(text).toContain("/Filter /DCTDecode");
  });

  it("gives every page its own image and content stream", () => {
    const text = ascii(buildPdf([page(), page()]));
    expect(text).toContain("/Kids [3 0 R 6 0 R]");
    expect(text).toContain("/XObject << /Im0 4 0 R >>");
    expect(text).toContain("/XObject << /Im0 7 0 R >>");
  });
});
