/**
 * Browser twin of `durable-photo-file.ts`. The web keeps a picked photo as a
 * self-contained `data:` uri (`durable-photo-uri.ts`), so there is no file
 * to write or delete; this keeps `expo-image-manipulator` out of the web
 * bundle.
 */

export const DURABLE_PHOTO_FOLDER = "photos";

export interface DurablePhotoSource {
  uri: string;
  width?: number;
  height?: number;
}

export async function writeDurablePhotoFile(
  asset: DurablePhotoSource,
  _maxEdgePx: number,
  _quality: number,
): Promise<string> {
  return asset.uri;
}

export function releaseDurablePhoto(_uri: string): void {
  // Nothing on disk to free in the browser.
}
