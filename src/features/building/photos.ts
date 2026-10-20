import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";

import { dataUriMimeType, toDurablePhotoUri } from "@/lib/durable-photo-uri";
import { HOME_PHOTO_MAX_BYTES } from "./constants";
import type { PictogramName } from "./pictograms.generated";
import { HomeError } from "./types";

/** The ten suggested photos (all optional), in the order they are offered. */
export const PHOTO_SLOTS = [
  "front",
  "back",
  "left",
  "right",
  "ground",
  "roof",
  "column",
  "ceiling",
  "cracks",
  "basement",
] as const;
export type PhotoSlot = (typeof PHOTO_SLOTS)[number];
/** Where a stored photo belongs: a suggested slot, or an extra ("more"). */
export type StoredPhotoSlot = PhotoSlot | "more";
export type PhotoSource = "camera" | "library";

/** The guiding drawing of each slot (`assets/artwork/building/photo-*.svg`). */
export const PHOTO_SLOT_PICTOGRAM: Readonly<Record<PhotoSlot, PictogramName>> = {
  front: "photo-front",
  back: "photo-back",
  left: "photo-left",
  right: "photo-right",
  ground: "photo-ground-floor",
  roof: "photo-roof",
  column: "photo-column-wall",
  ceiling: "photo-ceiling",
  cracks: "photo-cracks",
  basement: "photo-basement",
};

/** One photo waiting to be saved with a new home. */
export interface DraftPhoto {
  uri: string;
  slot: StoredPhotoSlot;
  /** Extras only; empty for suggested slots. */
  caption: string;
}

export function isStoredSlot(value: string): value is StoredPhotoSlot {
  return value === "more" || (PHOTO_SLOTS as readonly string[]).includes(value);
}

/** Longest edge of a home photo; with the JPEG quality below it lands near
 * the 0.5 MB target (the bucket limit is 3 MB). Web and phone alike
 * (`toDurablePhotoUri`). */
export const HOME_PHOTO_MAX_EDGE_PX = 1280;
export const HOME_PHOTO_JPEG_QUALITY = 0.6;
/** The picker hands over the photo at full quality: `toDurablePhotoUri`
 * downscales and encodes it once, rather than a second lossy pass over the
 * picker's own low-quality JPEG. */
const HOME_PHOTO_PICKER_QUALITY = 1;

/** `<slot>-<time><random>.jpg`: the storage file name carries the slot, so a
 * photo still lands in the right place when its metadata row is missing. */
export function photoFileName(
  slot: StoredPhotoSlot,
  stamp: number,
  random: string,
): string {
  return `${slot}-${stamp}${random}.jpg`;
}

export function slotFromFileName(fileName: string): StoredPhotoSlot {
  const head = fileName.split("-")[0] ?? "";
  return isStoredSlot(head) ? head : "more";
}

/**
 * Picks (or takes) one photo and returns a uri safe to upload later, or null
 * when the user cancelled or the camera permission was refused. The photo is
 * downscaled to 1280 px and saved as JPEG at 0.6 (about 0.5 MB): in a canvas
 * on the web, with `expo-image-manipulator` on a phone, where it is also
 * kept in the app's Documents folder so a queued upload still finds it. The
 * upload step still refuses anything over the 3 MB bucket limit.
 */
export async function pickHomePhoto(source: PhotoSource): Promise<string | null> {
  if (source === "camera" && Platform.OS !== "web") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      return null;
    }
  }
  const options = {
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: HOME_PHOTO_PICKER_QUALITY,
    allowsEditing: false,
  } as const;
  const result =
    source === "camera"
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync({
          ...options,
          allowsMultipleSelection: false,
        });
  if (result.canceled || !result.assets[0]) {
    return null;
  }
  return await toDurablePhotoUri(result.assets[0], {
    maxEdgePx: HOME_PHOTO_MAX_EDGE_PX,
    quality: HOME_PHOTO_JPEG_QUALITY,
  });
}

export function photoContentType(uri: string): string {
  const fromData = dataUriMimeType(uri);
  if (
    fromData === "image/png" ||
    fromData === "image/webp" ||
    fromData === "image/jpeg"
  ) {
    return fromData;
  }
  const lower = uri.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

/** Reads a picked photo's bytes, refusing anything over the 3 MB bucket limit. */
export async function readHomePhoto(uri: string): Promise<Blob | ArrayBuffer> {
  const body =
    Platform.OS === "web"
      ? await (await fetch(uri)).blob()
      : await new File(uri).arrayBuffer();
  const size = body instanceof ArrayBuffer ? body.byteLength : body.size;
  if (size > HOME_PHOTO_MAX_BYTES) {
    throw new HomeError("photo_too_large");
  }
  return body;
}
