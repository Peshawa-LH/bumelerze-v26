/**
 * A minimal PDF writer: enough to wrap one or more page images into a
 * standards-conformant A4 document, and nothing else.
 *
 * WHY WRITE THIS RATHER THAN TAKE A LIBRARY
 * -----------------------------------------
 * The engineer asked for a file that says `.pdf`, and every JS route to one
 * has a cost. The libraries that lay out text (`pdf-lib`, `jsPDF`) map
 * code points straight to glyphs: they do no Arabic shaping and no bidi
 * reordering, so a Sorani or Arabic report comes out as disconnected
 * letters in the wrong order. That is worse than no PDF at all, and it
 * would ship broken to the two locales the app exists for.
 *
 * So the page is rasterised by the browser itself, which is the one engine
 * on the device that shapes Kurdish and Arabic correctly, and this module
 * only has to carry the resulting image. Wrapping an image needs about a
 * page of PDF syntax and no dependency at all.
 *
 * WHAT THAT COSTS
 * ---------------
 * The text in the PDF is not selectable or searchable, because it is
 * pixels. That is the trade for correct Kurdish. The HTML report is still
 * offered alongside, and printing THAT from a browser gives a PDF with
 * live text and vector figures for anyone who needs one.
 *
 * This module is deliberately DOM-free so it can be tested directly.
 */

/** A4 in PDF units (points, 1/72 inch). */
export const A4_WIDTH_PT = 595.28;
export const A4_HEIGHT_PT = 841.89;

export interface PdfPageImage {
  /** Encoded image bytes, matching `filter`. */
  data: Uint8Array;
  width: number;
  height: number;
  /** `DCTDecode` for JPEG bytes, `FlateDecode` for zlib-compressed RGB. */
  filter: "DCTDecode" | "FlateDecode";
}

function toBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    out[i] = text.charCodeAt(i) & 0xff;
  }
  return out;
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/**
 * Wraps page images into a PDF, one image per page, each scaled to fill an
 * A4 page.
 *
 * The cross-reference table has to carry the byte offset of every object,
 * so the file is assembled as a list of chunks while a running offset is
 * kept — appending to a string would be wrong the moment an image contains
 * a byte that is not valid UTF-8.
 */
export function buildPdf(pages: readonly PdfPageImage[]): Uint8Array {
  if (pages.length === 0) {
    throw new Error("buildPdf: at least one page is required");
  }

  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let position = 0;

  const push = (bytes: Uint8Array) => {
    chunks.push(bytes);
    position += bytes.length;
  };
  const text = (value: string) => push(toBytes(value));
  const startObject = (id: number) => {
    offsets[id] = position;
    text(`${id} 0 obj\n`);
  };

  // 1 catalog, 2 page tree, then three objects per page: page, image,
  // content stream.
  const pageId = (i: number) => 3 + i * 3;
  const imageId = (i: number) => 4 + i * 3;
  const contentId = (i: number) => 5 + i * 3;

  text("%PDF-1.4\n");
  // A binary comment marks the file as binary for tools that sniff it.
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  startObject(1);
  text("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  startObject(2);
  const kids = pages.map((_, i) => `${pageId(i)} 0 R`).join(" ");
  text(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`);

  pages.forEach((page, i) => {
    startObject(pageId(i));
    text(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_WIDTH_PT} ${A4_HEIGHT_PT}] ` +
        `/Resources << /XObject << /Im0 ${imageId(i)} 0 R >> >> ` +
        `/Contents ${contentId(i)} 0 R >>\nendobj\n`,
    );

    startObject(imageId(i));
    text(
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${page.filter} ` +
        `/Length ${page.data.length} >>\nstream\n`,
    );
    push(page.data);
    text("\nendstream\nendobj\n");

    // The image fills the page. `cm` sets the transform: PDF user space
    // has its origin bottom-left, and an image XObject draws into the
    // unit square, so the matrix IS the page rectangle.
    const draw = `q\n${A4_WIDTH_PT} 0 0 ${A4_HEIGHT_PT} 0 0 cm\n/Im0 Do\nQ\n`;
    startObject(contentId(i));
    text(`<< /Length ${draw.length} >>\nstream\n${draw}endstream\nendobj\n`);
  });

  const objectCount = 3 + pages.length * 3;
  const xrefAt = position;
  text(`xref\n0 ${objectCount}\n`);
  text("0000000000 65535 f \n");
  for (let id = 1; id < objectCount; id += 1) {
    text(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  }
  text(`trailer\n<< /Size ${objectCount} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  return concat(chunks);
}
