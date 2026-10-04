import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";

import { dataUriMimeType, toDurablePhotoUri } from "@/lib/durable-photo-uri";
import { HOME_PHOTO_MAX_BYTES } from "./constants";
import { HomeError } from "./types";

/** The three guided photos (all optional). */
export const PHOTO_SLOTS = ["front", "side", "inside"] as const;
export type PhotoSlot = (typeof PHOTO_SLOTS)[number];
export type PhotoSource = "camera" | "library";

/** Longest edge of a home photo on web; the bucket limit is 3 MB. */
const HOME_PHOTO_MAX_EDGE_PX = 1600;

/**
 * Picks (or takes) one photo and returns a uri safe to upload later, or null
 * when the user cancelled or the camera permission was refused. Same pattern
 * as the felt-report photo: aggressive JPEG quality instead of an image
 * manipulation module (no new native dependency), web downscaled in a canvas.
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
    quality: 0.5,
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
