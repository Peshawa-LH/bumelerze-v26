import { SHARE_IMAGE_HEIGHTS, SHARE_IMAGE_WIDTH } from "./config";
import type { ImageDeliveryOutcome, ImageDeliveryRequest } from "./image-export.types";
import { SHARE_FONT_BOLD, SHARE_FONT_REGULAR } from "./share-font-names";
import { isShareAbort, copyText } from "./share-text";
import { base64ToPngFile, rasterizeSvgString, serializeCardSvg } from "./svg-serialize";
import type { ShareCardSize, ShareImage } from "./types";

/**
 * Browser export of the share card: serialise the mounted `<svg>` with the
 * Vazirmatn faces embedded, rasterise through a canvas, deliver with the Web
 * Share API (files) where the browser allows it, else download plus copy the
 * caption. Twin of `image-export.ts` (phones); same exports.
 */

interface WebNavigator {
  canShare?: (data: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
}

function webNavigator(): WebNavigator | undefined {
  return typeof navigator === "undefined" ? undefined : (navigator as WebNavigator);
}

/** The DOM node behind a react-native-svg element ref on the web. */
function domNodeOf(card: unknown): Element | null {
  if (typeof Element !== "undefined" && card instanceof Element) {
    return card;
  }
  const holder = card as { elementRef?: { current?: Element | null } } | null;
  return holder?.elementRef?.current ?? null;
}

/**
 * True when this browser can hand a PNG file to its share sheet. Probed with
 * a throwaway file, as `canShare` requires real `File` objects.
 */
export function canShareImageFiles(): boolean {
  const nav = webNavigator();
  if (!nav || typeof nav.canShare !== "function" || typeof nav.share !== "function") {
    return false;
  }
  try {
    return nav.canShare({
      files: [new File([new Uint8Array(1)], "probe.png", { type: "image/png" })],
    });
  } catch {
    return false;
  }
}

export async function rasterizeCard(
  card: unknown,
  size: ShareCardSize,
): Promise<ShareImage> {
  const node = domNodeOf(card);
  if (!node) {
    throw new Error("share card is not mounted");
  }
  const width = SHARE_IMAGE_WIDTH;
  const height = SHARE_IMAGE_HEIGHTS[size];
  // The font data (~90 KB of base64) is its own chunk, fetched only now.
  const data = await import("./share-font-data");
  const svg = serializeCardSvg(
    node,
    { width, height },
    {
      regularFamily: SHARE_FONT_REGULAR,
      regularBase64: data.VAZIRMATN_REGULAR_WOFF2_BASE64,
      boldFamily: SHARE_FONT_BOLD,
      boldBase64: data.VAZIRMATN_BOLD_WOFF2_BASE64,
    },
  );
  const base64 = await rasterizeSvgString(svg, width, height);
  return { size, width, height, base64 };
}

function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Give the browser a moment to start the download before the URL goes.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Hands the PNG to the user. Web Share needs a live user gesture, so this
 * must be called straight from the tap with an image that is already
 * rendered: nothing here awaits before the share call.
 */
export async function deliverImage(
  image: ShareImage,
  { fileName, caption, title }: ImageDeliveryRequest,
): Promise<ImageDeliveryOutcome> {
  const file = base64ToPngFile(image.base64, fileName);
  const nav = webNavigator();
  if (nav && typeof nav.share === "function" && typeof nav.canShare === "function") {
    let allowed = false;
    try {
      allowed = nav.canShare({ files: [file] });
    } catch {
      allowed = false;
    }
    if (allowed) {
      try {
        await nav.share({ files: [file], text: caption, title });
        return "shared";
      } catch (error) {
        if (isShareAbort(error)) {
          return "cancelled";
        }
        // Any other refusal: fall back to a download below.
      }
    }
  }
  downloadFile(file);
  await copyText(caption);
  return "downloaded";
}
