import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform, Share, type View } from "react-native";
import { captureRef } from "react-native-view-shot";

import { SHARE_IMAGE_HEIGHTS, SHARE_IMAGE_WIDTH } from "./config";
import type { ImageDeliveryOutcome, ImageDeliveryRequest } from "./image-export.types";
import { copyText } from "./share-text";
import type { ShareCardSize, ShareImage } from "./types";

/**
 * Phone (iOS and Android) export of the share card. Twin of
 * `image-export.web.ts`; same exports.
 *
 * The phone card is the SVG drawing with its words as phone text over it
 * (`ShareCardSvg.tsx`: react-native-svg does not join Sorani or Arabic
 * letters on iOS), so the image is a capture of that view
 * (`react-native-view-shot`), not an SVG render.
 */

/** Phones always have a system share sheet that takes a file. */
export function canShareImageFiles(): boolean {
  return true;
}

/**
 * Captures the mounted card (its outer view, mounted by `CardRenderer` at
 * the width that captures as 1080 pixels) as a PNG. Android scales the capture to the exact
 * pixel size asked for; iOS takes the size in points, so it is left to the
 * view's own size there.
 */
export async function rasterizeCard(card: unknown, size: ShareCardSize): Promise<ShareImage> {
  if (!card) {
    throw new Error("share card is not mounted");
  }
  const width = SHARE_IMAGE_WIDTH;
  const height = SHARE_IMAGE_HEIGHTS[size];
  const base64 = await captureRef(card as View, {
    format: "png",
    result: "base64",
    ...(Platform.OS === "android" ? { width, height } : {}),
  });
  if (!base64) {
    throw new Error("share card export returned no data");
  }
  return { size, width, height, base64 };
}

/**
 * Writes the PNG to the cache folder and opens the system share sheet with
 * the picture AND the caption (its text and link), as the web does.
 *
 * iOS: React Native's share sheet takes both at once. Messages, WhatsApp,
 * Mail and X receive the two together; "Save Image" keeps the picture in
 * Photos (the app declares the add-to-Photos permission text).
 * Android: React Native's share sheet cannot carry a file, so the picture
 * goes through `expo-sharing` and the caption is copied first, ready to
 * paste (Instagram and TikTok take the picture only anyway).
 */
export async function deliverImage(
  image: ShareImage,
  { fileName, caption, title }: ImageDeliveryRequest,
): Promise<ImageDeliveryOutcome> {
  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true });
  file.write(image.base64, { encoding: "base64" });
  if (Platform.OS === "ios") {
    const result = await Share.share({ url: file.uri, message: caption }, { subject: title });
    return result.action === Share.dismissedAction ? "cancelled" : "shared";
  }
  if (!(await Sharing.isAvailableAsync())) {
    return "unavailable";
  }
  await copyText(caption);
  await Sharing.shareAsync(file.uri, {
    mimeType: "image/png",
    UTI: "public.png",
    dialogTitle: title,
  });
  // The system share sheet does not say whether the user finished or backed out.
  return "shared";
}
