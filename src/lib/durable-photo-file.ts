import { Directory, File, Paths } from "expo-file-system";

/**
 * Phone half of `durable-photo-uri.ts`: a picked photo, downscaled and
 * re-encoded like the web does it, kept where the system never deletes it.
 * Twin of `durable-photo-file.web.ts` (the browser keeps a `data:` uri
 * instead, so there is no file there).
 */

/** The folder in Documents that keeps picked photos until they are uploaded. */
export const DURABLE_PHOTO_FOLDER = "photos";

/** What the writer needs from a picked asset. */
export interface DurablePhotoSource {
  uri: string;
  width?: number;
  height?: number;
}

/** A file name no other kept photo has: the time plus a random tail. */
export function durablePhotoName(now: number = Date.now(), random: number = Math.random()): string {
  return `${now.toString(36)}-${Math.floor(random * 36 ** 8).toString(36).padStart(8, "0")}.jpg`;
}

function photoFolder(): Directory {
  const folder = new Directory(Paths.document, DURABLE_PHOTO_FOLDER);
  folder.create({ intermediates: true, idempotent: true });
  return folder;
}

/** The new size when the longest edge is over `maxEdgePx`, else `null`
 * (a small photo is re-encoded, never enlarged). */
export function downscaleSize(
  width: number,
  height: number,
  maxEdgePx: number,
): { width: number; height: number } | null {
  const scale = maxEdgePx / Math.max(width, height);
  if (!(scale < 1)) {
    return null;
  }
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Downscales the photo to `maxEdgePx` on its longest edge, saves it as JPEG
 * at `quality`, and moves it into `Documents/photos/`. Returns its
 * `file://` uri. An image that cannot be re-encoded is copied there full
 * size (still durable; the upload checks the size limit); if even that
 * fails, the picker's own uri comes back, as before.
 */
export async function writeDurablePhotoFile(
  asset: DurablePhotoSource,
  maxEdgePx: number,
  quality: number,
): Promise<string> {
  const target = new File(photoFolder(), durablePhotoName());
  try {
    // Required at the first photo rather than imported at the top: the module
    // brings in the `expo` runtime, which replaced `fetch` in the tests of
    // every transport that imports this file. A plain `require` stays in the
    // main bundle (an `import()` became a separate download in development).
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deferred on purpose, see above
    const { ImageManipulator, SaveFormat } = require("expo-image-manipulator") as typeof import("expo-image-manipulator");
    const context = ImageManipulator.manipulate(asset.uri);
    try {
      let { width, height } = asset;
      if (!width || !height) {
        const probe = await context.renderAsync();
        width = probe.width;
        height = probe.height;
        probe.release();
      }
      const size = downscaleSize(width, height, maxEdgePx);
      if (size) {
        context.resize(size);
      }
      const image = await context.renderAsync();
      try {
        const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: quality });
        new File(saved.uri).moveSync(target);
      } finally {
        image.release();
      }
    } finally {
      context.release();
    }
    return target.uri;
  } catch {
    try {
      new File(asset.uri).copySync(target);
      return target.uri;
    } catch {
      return asset.uri;
    }
  }
}

/**
 * Deletes a photo `writeDurablePhotoFile` kept, once its upload is
 * confirmed. Anything else (a file outside the photo folder, a remote or
 * `data:` uri) is left alone, so a caller can pass any stored uri. Never
 * throws.
 */
export function releaseDurablePhoto(uri: string): void {
  if (!uri.startsWith("file:")) {
    return;
  }
  try {
    const folder = new Directory(Paths.document, DURABLE_PHOTO_FOLDER).uri.replace(/\/?$/, "/");
    if (!uri.startsWith(folder)) {
      return;
    }
    const file = new File(uri);
    if (file.exists) {
      file.delete();
    }
  } catch {
    // Already gone, or the folder is unreadable: nothing to free.
  }
}
