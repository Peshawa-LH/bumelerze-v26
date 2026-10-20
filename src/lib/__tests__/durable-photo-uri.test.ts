import { Platform } from "react-native";

import { blobToDataUrl, dataUriMimeType, toDurablePhotoUri } from "../durable-photo-uri";

const mockWriteFile = jest.fn();
jest.mock("../durable-photo-file", () => ({
  writeDurablePhotoFile: (...args: unknown[]) => mockWriteFile(...args),
  releaseDurablePhoto: jest.fn(),
}));

/** Eleven feedback screenshots died on 2026-09-27 because a web `blob:`
 * uri was persisted and fetched later; this helper reads the bytes at pick
 * time instead. */
describe("dataUriMimeType", () => {
  it.each([
    ["data:image/png;base64,iVBOR", "image/png"],
    ["data:image/jpeg;base64,/9j/", "image/jpeg"],
    ["data:IMAGE/WEBP;base64,UklG", "image/webp"],
  ])("reads the declared type of %s", (uri, mime) => {
    expect(dataUriMimeType(uri)).toBe(mime);
  });

  it.each(["blob:https://bumelerze.com/1234", "file:///tmp/photo.jpg", "https://x/y.png", ""])(
    "returns null for a non-data uri %s",
    (uri) => {
      expect(dataUriMimeType(uri)).toBeNull();
    },
  );
});

describe("toDurablePhotoUri", () => {
  const originalOS = Platform.OS;
  afterEach(() => {
    Object.defineProperty(Platform, "OS", { value: originalOS, configurable: true });
    delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
  });

  it("on a phone, keeps a downscaled copy at the web's size and quality, never the picker's cache file", async () => {
    // iOS parity item 14: the picker's file was passed straight through,
    // from a cache folder the system may empty before a queued upload.
    Object.defineProperty(Platform, "OS", { value: "ios", configurable: true });
    mockWriteFile.mockResolvedValue("file:///docs/photos/a.jpg");
    const asset = { uri: "file:///cache/p.jpg", width: 4032, height: 3024 };
    await expect(toDurablePhotoUri(asset)).resolves.toBe("file:///docs/photos/a.jpg");
    expect(mockWriteFile).toHaveBeenCalledWith(asset, 1600, 0.72);
    await toDurablePhotoUri(asset, { maxEdgePx: 256, quality: 0.8 });
    expect(mockWriteFile).toHaveBeenLastCalledWith(asset, 256, 0.8);
  });

  it("on web, falls back to a full data uri of the picked file when the canvas path is unavailable", async () => {
    Object.defineProperty(Platform, "OS", { value: "web", configurable: true });
    // jsdom has no createImageBitmap — the downscale throws, and the
    // helper must still hand back something self-contained.
    const file = new Blob([Uint8Array.from([1, 2, 3])], { type: "image/png" });
    const uri = await toDurablePhotoUri({ uri: "blob:https://bumelerze.com/abc", file });
    expect(uri.startsWith("data:image/png;base64,")).toBe(true);
    expect(dataUriMimeType(uri)).toBe("image/png");
  });

  it("never returns the blob: uri it was given on web", async () => {
    Object.defineProperty(Platform, "OS", { value: "web", configurable: true });
    const file = new Blob(["x"], { type: "image/jpeg" });
    const uri = await toDurablePhotoUri({ uri: "blob:https://bumelerze.com/dead", file });
    expect(uri.startsWith("blob:")).toBe(false);
  });
});

describe("blobToDataUrl", () => {
  it("encodes a blob with its own mime type", async () => {
    const uri = await blobToDataUrl(new Blob(["hi"], { type: "text/plain" }));
    expect(uri).toBe("data:text/plain;base64,aGk=");
  });
});
