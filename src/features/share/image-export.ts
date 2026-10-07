import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type Svg from "react-native-svg";

import { SHARE_IMAGE_HEIGHTS, SHARE_IMAGE_WIDTH } from "./config";
import type { ImageDeliveryOutcome, ImageDeliveryRequest } from "./image-export.types";
import type { ShareCardSize, ShareImage } from "./types";

/**
 * Phone (iOS and Android) export of the share card.
 *
 * NOT YET VERIFIED ON A DEVICE: the native `Svg.toDataURL` snapshot and the
 * Arabic-script shaping of Vazirmatn inside react-native-svg on a low-end
 * Android phone can only be checked on a development build. The code follows
 * the library's documented contract; the web export is the verified twin.
 */

/** Phones always have a system share sheet that takes a file. */
export function canShareImageFiles(): boolean {
  return true;
}

/**
 * Rasterises the mounted card to a 1080-wide PNG. The card is mounted small
 * (its viewBox is the full 1080 card), and the library scales the vectors up
 * to the requested size, so the intermediate bitmap is exactly the final one.
 */
export function rasterizeCard(card: unknown, size: ShareCardSize): Promise<ShareImage> {
  const svg = card as Svg | null;
  if (!svg || typeof svg.toDataURL !== "function") {
    return Promise.reject(new Error("share card is not mounted"));
  }
  const width = SHARE_IMAGE_WIDTH;
  const height = SHARE_IMAGE_HEIGHTS[size];
  return new Promise<ShareImage>((resolve, reject) => {
    try {
      svg.toDataURL(
        (base64: string) => {
          if (!base64) {
            reject(new Error("share card export returned no data"));
            return;
          }
          resolve({ size, width, height, base64 });
        },
        { width, height },
      );
    } catch (error) {
      reject(error);
    }
  });
}

/** Writes the PNG to the cache folder and opens the system share sheet. */
export async function deliverImage(
  image: ShareImage,
  { fileName, title }: ImageDeliveryRequest,
): Promise<ImageDeliveryOutcome> {
  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true });
  file.write(image.base64, { encoding: "base64" });
  if (!(await Sharing.isAvailableAsync())) {
    return "unavailable";
  }
  await Sharing.shareAsync(file.uri, {
    mimeType: "image/png",
    UTI: "public.png",
    dialogTitle: title,
  });
  // The system share sheet does not say whether the user finished or backed out.
  return "shared";
}
