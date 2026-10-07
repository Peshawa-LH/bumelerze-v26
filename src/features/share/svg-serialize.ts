/**
 * Browser-side helpers that turn the mounted share card into a PNG. Kept free
 * of any React or React Native import so they can run (and be tested) against
 * a plain DOM.
 *
 * react-native-svg's own web `toDataURL` clones the node into a standalone SVG
 * image, and a standalone SVG image cannot use the page's fonts, so Sorani
 * would fall back to whatever the device has. Instead the card is cloned here
 * and the two Vazirmatn faces are embedded in it as base64 @font-face rules.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

export interface EmbeddedFonts {
  /** Family name used by the card's regular text. */
  regularFamily: string;
  regularBase64: string;
  /** Family name used by the card's bold text. */
  boldFamily: string;
  boldBase64: string;
}

/** The @font-face rules for the two faces. Weight stays `normal` for both:
 * the card selects bold by family name, so the browser must not synthesise
 * a second, heavier bold on top. */
export function buildFontFaceCss(fonts: EmbeddedFonts): string {
  const face = (family: string, base64: string) =>
    `@font-face{font-family:'${family}';font-style:normal;font-weight:400;` +
    `src:url(data:font/woff2;base64,${base64}) format('woff2');}`;
  return (
    face(fonts.regularFamily, fonts.regularBase64) +
    face(fonts.boldFamily, fonts.boldBase64)
  );
}

/**
 * A standalone `<svg>` document string for the mounted card element: sized to
 * the export size, with the page's inherited direction pinned to ltr (every
 * string carries its own bidi isolate and a physical anchor, so an
 * `dir="rtl"` page must not flip `text-anchor`), and the fonts embedded.
 */
export function serializeCardSvg(
  node: Element,
  size: { width: number; height: number },
  fonts: EmbeddedFonts,
): string {
  const clone = node.cloneNode(true) as Element;
  clone.setAttribute("xmlns", SVG_NS);
  clone.setAttribute("width", String(size.width));
  clone.setAttribute("height", String(size.height));
  clone.setAttribute("direction", "ltr");
  // react-native-web may put layout styles on the live node; the standalone
  // image needs none of them, and `direction: rtl` from the page must not win
  // over the attribute above.
  clone.setAttribute("style", "direction:ltr;unicode-bidi:isolate");
  clone.removeAttribute("class");

  const doc = node.ownerDocument;
  const defs = doc.createElementNS(SVG_NS, "defs");
  const style = doc.createElementNS(SVG_NS, "style");
  style.textContent = buildFontFaceCss(fonts);
  defs.appendChild(style);
  clone.insertBefore(defs, clone.firstChild);

  return new XMLSerializer().serializeToString(clone);
}

/** WebKit loads fonts embedded in an SVG image lazily, so its first paint can
 * still use a fallback face. Chromium and Gecko are fine on the first pass. */
function needsSecondPaint(userAgent: string): boolean {
  const webkit = /AppleWebKit/i.test(userAgent);
  const chromium = /Chrome\/|Chromium\/|Edg\//i.test(userAgent);
  const iosBrowser = /CriOS|FxiOS|EdgiOS/i.test(userAgent);
  return (webkit && !chromium) || iosBrowser;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("share card image failed to load"));
    image.src = url;
  });
}

/**
 * Rasterises an SVG document string to PNG at exactly `width` x `height`.
 * Returns the PNG as base64. The SVG is loaded from a blob URL (no huge data
 * URL in memory twice). On WebKit the image is painted a second time after
 * its fonts have had a chance to decode (not verified on a real Safari yet).
 */
export async function rasterizeSvgString(
  svg: string,
  width: number,
  height: number,
): Promise<string> {
  const blobUrl = URL.createObjectURL(
    new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
  );
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("canvas 2d context unavailable");
    }
    const paint = async () => {
      const image = await loadImage(blobUrl);
      if (typeof image.decode === "function") {
        await image.decode().catch(() => undefined);
      }
      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
    };
    await paint();
    if (needsSecondPaint(navigator.userAgent)) {
      await new Promise((resolve) => setTimeout(resolve, 60));
      await paint();
    }
    return canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/** A PNG `File` from base64, synchronously (no await before a share call). */
export function base64ToPngFile(base64: string, fileName: string): File {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], fileName, { type: "image/png" });
}
