import type { TFunction } from "i18next";

import { buildReportHtml, buildReportFragment, type ReportInput } from "./report-html";
import { buildPdf, type PdfPageImage } from "./report-pdf";

/**
 * Turns the report into A4 page images, using the browser's own layout and
 * text engine.
 *
 * WHY THE BROWSER DOES THE RENDERING
 * ----------------------------------
 * Two of this app's four locales are Arabic-script and right-to-left. Every
 * JS PDF library that writes text maps code points straight to glyphs: no
 * joining, no contextual forms, no bidi. Sorani would come out as a row of
 * disconnected letters in the wrong order, and it would look fine to
 * anyone reviewing it in English. The browser is the one text engine on the
 * device that gets Kurdish right, so the page is drawn by the browser and
 * this module only captures the result.
 *
 * The capture is an `<svg><foreignObject>` holding the report's own markup,
 * loaded as an image. No library, no second rendering engine to disagree
 * with the first: what the engineer saw is literally what is drawn.
 */

const PX_PER_MM = 96 / 25.4;
const PAGE_MM = { width: 210, height: 297, margin: 13 };
/** 3x CSS pixels is about 283 dpi on A4: past the point where print shows
 * the difference, and still a file that fits in an email. */
const SCALE = 3;

function pageBoxPx(): { width: number; height: number } {
  return {
    width: Math.round((PAGE_MM.width - PAGE_MM.margin * 2) * PX_PER_MM),
    height: Math.round((PAGE_MM.height - PAGE_MM.margin * 2) * PX_PER_MM),
  };
}

/**
 * Lays the report out in an isolated iframe and returns it as well-formed
 * XHTML plus its height.
 *
 * The iframe is not optional. The report's stylesheet styles `body` and
 * declares `@page`; dropped into the app's own document to be measured it
 * would restyle the app underneath the user for as long as it was there.
 * A separate document also means the measurement is of the report alone,
 * with none of the app's inherited font sizes reaching it.
 */
function layoutInIsolation(
  data: ReportInput,
  t: TFunction,
): { xhtml: string; width: number; height: number } {
  const box = pageBoxPx();
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${box.width}px;height:${box.height}px;border:0;visibility:hidden;`;
  document.body.appendChild(frame);
  try {
    const doc = frame.contentDocument;
    if (!doc) {
      throw new Error("report raster: the measuring frame has no document");
    }
    doc.open();
    doc.write(buildReportHtml(data, t));
    doc.close();
    // Nothing is awaited here on purpose. The frame is not rendered, and a
    // browser does not run requestAnimationFrame for a frame it is not
    // painting: waiting on one hangs forever, which is exactly what the
    // first version of this did. Reading `scrollHeight` below flushes
    // layout synchronously, and the report needs nothing else to load --
    // its figures are inline SVG and its fonts are the system's.

    const { styles, content } = buildReportFragment(data, t);
    const root = doc.createElement("div");
    root.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    root.setAttribute("class", "report-page");
    // Through the DOM rather than by string concatenation: the report's
    // markup is HTML (`<br>`, unquoted-safe attributes) and foreignObject
    // takes XHTML. Parsing then re-serialising is what converts it.
    root.innerHTML = `<style>${styles}</style>${content}`;
    const xhtml = new XMLSerializer().serializeToString(root);

    const height = Math.max(doc.body.scrollHeight, box.height);
    return { xhtml, width: box.width, height };
  } finally {
    frame.remove();
  }
}

function drawToCanvas(
  xhtml: string,
  width: number,
  height: number,
): Promise<HTMLCanvasElement> {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject width="100%" height="100%">${xhtml}</foreignObject></svg>`;
  const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * SCALE);
      canvas.height = Math.round(height * SCALE);
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("report raster: no 2d context"));
        return;
      }
      // Paper is white. Without this the page is drawn on transparency,
      // which a PDF viewer is free to composite onto black.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas);
    };
    image.onerror = () => reject(new Error("report raster: the page image failed to load"));
    image.src = source;
  });
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream !== "function") {
    return null;
  }
  // `deflate` is the zlib wrapper, which is what PDF's FlateDecode reads;
  // `deflate-raw` would be rejected by every viewer.
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** One A4 page's worth of the canvas, encoded for embedding. */
async function encodeSlice(
  canvas: HTMLCanvasElement,
  top: number,
  sliceHeight: number,
): Promise<PdfPageImage> {
  const slice = document.createElement("canvas");
  slice.width = canvas.width;
  slice.height = sliceHeight;
  const context = slice.getContext("2d");
  if (!context) {
    throw new Error("report raster: no 2d context for the slice");
  }
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, slice.width, slice.height);
  context.drawImage(canvas, 0, -top);

  const { data } = context.getImageData(0, 0, slice.width, slice.height);
  // RGBA to RGB: PDF's DeviceRGB has no alpha channel, and the page was
  // drawn onto white so there is none to keep.
  const rgb = new Uint8Array((data.length / 4) * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i] as number;
    rgb[j + 1] = data[i + 1] as number;
    rgb[j + 2] = data[i + 2] as number;
  }

  const flate = await deflate(rgb);
  if (flate) {
    return { data: flate, width: slice.width, height: slice.height, filter: "FlateDecode" };
  }

  // Older Safari has no CompressionStream. JPEG is lossy on text, which is
  // why it is the fallback and not the default, but a slightly soft PDF
  // beats no PDF.
  const blob = await new Promise<Blob | null>((resolve) =>
    slice.toBlob(resolve, "image/jpeg", 0.94),
  );
  if (!blob) {
    throw new Error("report raster: could not encode the page");
  }
  return {
    data: new Uint8Array(await blob.arrayBuffer()),
    width: slice.width,
    height: slice.height,
    filter: "DCTDecode",
  };
}

/** The report as PDF bytes. */
export async function buildReportPdf(data: ReportInput, t: TFunction): Promise<Uint8Array> {
  const { xhtml, width, height } = layoutInIsolation(data, t);
  const canvas = await drawToCanvas(xhtml, width, height);

  const pageHeightPx = Math.round(pageBoxPx().height * SCALE);
  const pages: PdfPageImage[] = [];
  // Normally one pass: the report is laid out to close on a single A4
  // side. The loop is what keeps an unusually long one readable instead
  // of clipped.
  for (let top = 0; top < canvas.height; top += pageHeightPx) {
    pages.push(await encodeSlice(canvas, top, Math.min(pageHeightPx, canvas.height - top)));
  }
  return buildPdf(pages);
}
