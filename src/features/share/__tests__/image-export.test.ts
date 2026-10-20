import { Platform, Share } from "react-native";

import { deliverImage, rasterizeCard } from "../image-export";
import type { ShareImage } from "../types";

const mockCapture = jest.fn();
jest.mock("react-native-view-shot", () => ({
  captureRef: (...args: unknown[]) => mockCapture(...args),
}));

const mockWrite = jest.fn();
const mockCreate = jest.fn();
jest.mock("expo-file-system", () => ({
  Paths: { cache: "file:///cache" },
  File: jest.fn().mockImplementation((dir: string, name: string) => ({
    uri: `${dir}/${name}`,
    create: (...args: unknown[]) => mockCreate(...args),
    write: (...args: unknown[]) => mockWrite(...args),
  })),
}));

const mockShareFile = jest.fn();
let mockSharingAvailable = true;
jest.mock("expo-sharing", () => ({
  isAvailableAsync: async () => mockSharingAvailable,
  shareAsync: (...args: unknown[]) => mockShareFile(...args),
}));

const mockCopy = jest.fn();
jest.mock("../share-text", () => ({
  copyText: (text: string) => mockCopy(text),
}));

const IMAGE: ShareImage = { size: "square", width: 1080, height: 1080, base64: "iVBORw0KGgo=" };
const REQUEST = {
  fileName: "bumelerze-bml202602ia-square.png",
  caption: "M3.2 earthquake · 81 km N of Urmia\nhttps://app.bumelerze.com/e/bml202602ia",
  title: "Share this earthquake",
};

describe("phone share image export", () => {
  const originalOS = Platform.OS;
  let share: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSharingAvailable = true;
    mockCapture.mockResolvedValue("iVBORw0KGgo=");
    mockShareFile.mockResolvedValue(undefined);
    mockCopy.mockResolvedValue(true);
    share = jest
      .spyOn(Share, "share")
      .mockResolvedValue({ action: Share.sharedAction, activityType: "x" } as never);
    Object.defineProperty(Platform, "OS", { value: "ios", configurable: true });
  });
  afterEach(() => {
    share.mockRestore();
    Object.defineProperty(Platform, "OS", { value: originalOS, configurable: true });
  });

  describe("rasterizeCard", () => {
    it("captures the mounted card view as a PNG at its own size on iOS", async () => {
      const view = { tag: 1 };
      await expect(rasterizeCard(view, "story")).resolves.toEqual({
        size: "story",
        width: 1080,
        height: 1920,
        base64: "iVBORw0KGgo=",
      });
      // iOS takes the size in points: the card is mounted at the size that
      // captures as 1080 pixels, so no size is passed.
      expect(mockCapture).toHaveBeenCalledWith(view, { format: "png", result: "base64" });
    });

    it("asks Android for the exact pixel size", async () => {
      Object.defineProperty(Platform, "OS", { value: "android", configurable: true });
      await rasterizeCard({}, "square");
      expect(mockCapture).toHaveBeenCalledWith(
        {},
        { format: "png", result: "base64", width: 1080, height: 1080 },
      );
    });

    it("fails when the card is not mounted or the capture is empty", async () => {
      await expect(rasterizeCard(null, "square")).rejects.toThrow("not mounted");
      mockCapture.mockResolvedValue("");
      await expect(rasterizeCard({}, "square")).rejects.toThrow("no data");
    });
  });

  describe("deliverImage", () => {
    it("iOS: shares the picture together with its caption (the image used to go alone)", async () => {
      await expect(deliverImage(IMAGE, REQUEST)).resolves.toBe("shared");
      expect(mockCreate).toHaveBeenCalledWith({ overwrite: true });
      expect(mockWrite).toHaveBeenCalledWith("iVBORw0KGgo=", { encoding: "base64" });
      expect(share).toHaveBeenCalledWith(
        { url: "file:///cache/bumelerze-bml202602ia-square.png", message: REQUEST.caption },
        { subject: "Share this earthquake" },
      );
      expect(mockShareFile).not.toHaveBeenCalled();
    });

    it("iOS: says nothing when the person closes the share sheet", async () => {
      share.mockResolvedValue({ action: Share.dismissedAction } as never);
      await expect(deliverImage(IMAGE, REQUEST)).resolves.toBe("cancelled");
    });

    it("Android: copies the caption, then shares the file", async () => {
      Object.defineProperty(Platform, "OS", { value: "android", configurable: true });
      await expect(deliverImage(IMAGE, REQUEST)).resolves.toBe("shared");
      expect(mockCopy).toHaveBeenCalledWith(REQUEST.caption);
      expect(mockShareFile).toHaveBeenCalledWith("file:///cache/bumelerze-bml202602ia-square.png", {
        mimeType: "image/png",
        UTI: "public.png",
        dialogTitle: "Share this earthquake",
      });
      expect(share).not.toHaveBeenCalled();
    });

    it("Android without a share sheet says so", async () => {
      Object.defineProperty(Platform, "OS", { value: "android", configurable: true });
      mockSharingAvailable = false;
      await expect(deliverImage(IMAGE, REQUEST)).resolves.toBe("unavailable");
      expect(mockShareFile).not.toHaveBeenCalled();
    });
  });
});
