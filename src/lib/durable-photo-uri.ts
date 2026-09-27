import { Platform } from "react-native";

/**
 * A picked photo's uri, made safe to persist and upload LATER.
 *
 * WHY THIS EXISTS. On web, `expo-image-picker` returns `URL.createObjectURL(file)`
 * — a `blob:` uri that is only a handle into the current document, never
 * bytes. Both queues (feedback, felt report) persist that string and upload
 * from it after the message row has landed, and on iOS Safari that later
 * `fetch(blob:)` fails: every screenshot Peshawa attached to eleven feedback
 * items on 2026-09-27 died this way, silently — zero storage requests ever
 * left the phone. The fix is to read the bytes while the `File` is still
 * live, at pick time, and carry a self-contained `data:` uri instead.
 *
 * Size: a persisted `data:` uri lives in AsyncStorage (localStorage on web,
 * ~5 MB per origin), so the image is downscaled to `maxEdgePx` and
 * re-encoded as JPEG before encoding. A phone screenshot lands well under
 * 300 KB; the picker's own `quality: 0.4` is not applied on web at all.
 *
 * Native returns the `file://` uri unchanged: the file outlives the
 * document, and the transports already read it with `expo-file-system`.
 */
export interface PickedAsset {
  uri: string;
  /** Present on web (`expo-image-picker`'s own asset shape). */
  file?: Blob;
  mimeType?: string;
}

export const DURABLE_PHOTO_MAX_EDGE_PX = 1600;
export const DURABLE_PHOTO_JPEG_QUALITY = 0.72;

export async function toDurablePhotoUri(
  asset: PickedAsset,
  { maxEdgePx = DURABLE_PHOTO_MAX_EDGE_PX, quality = DURABLE_PHOTO_JPEG_QUALITY } = {},
): Promise<string> {
  if (Platform.OS !== "web") {
    return asset.uri;
  }
  const blob: Blob = asset.file ?? (await fetch(asset.uri).then((r) => r.blob()));
  try {
    return await downscaleToJpegDataUrl(blob, maxEdgePx, quality);
  } catch {
    // Canvas can refuse (CSP, a HEIC the browser cannot decode) — a
    // full-size data uri is still durable, just bigger.
    return await blobToDataUrl(blob);
  }
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  // `Blob.arrayBuffer()` exists in every current browser and in Node, so
  // this path needs no `FileReader` event plumbing; the reader below is
  // only for a runtime that lacks it.
  if (typeof blob.arrayBuffer === "function" && typeof btoa === "function") {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    const CHUNK = 0x8000; // String.fromCharCode's argument limit
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("FileReader produced no data url"));
        return;
      }
      resolve(result);
    };
    reader.readAsDataURL(blob);
  });
}

async function downscaleToJpegDataUrl(blob: Blob, maxEdgePx: number, quality: number): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxEdgePx / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("no 2d context");
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", quality);
}

/** The mime type a `data:` uri declares, or `null` for any other uri. */
export function dataUriMimeType(uri: string): string | null {
  const match = /^data:([^;,]+)[;,]/i.exec(uri);
  return match?.[1]?.toLowerCase() ?? null;
}
