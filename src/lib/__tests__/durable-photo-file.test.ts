import {
  downscaleSize,
  durablePhotoName,
  releaseDurablePhoto,
  writeDurablePhotoFile,
} from "../durable-photo-file";

const mockResize = jest.fn();
const mockRender = jest.fn();
const mockSave = jest.fn();
const mockReleaseImage = jest.fn();
const mockReleaseContext = jest.fn();
let mockRendered = { width: 4032, height: 3024 };
jest.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg", PNG: "png" },
  ImageManipulator: {
    manipulate: (uri: string) => {
      const context = {
        uri,
        resize: (size: unknown) => {
          mockResize(size);
          return context;
        },
        renderAsync: async () => {
          mockRender();
          return {
            ...mockRendered,
            saveAsync: (options: unknown) => mockSave(options),
            release: () => mockReleaseImage(),
          };
        },
        release: () => mockReleaseContext(),
      };
      return context;
    },
  },
}));

const mockMove = jest.fn();
const mockCopy = jest.fn();
const mockDelete = jest.fn();
const mockMkdir = jest.fn();
let mockExists = true;
jest.mock("expo-file-system", () => {
  const uriOf = (parts: unknown[]) =>
    parts
      .map((part) => (typeof part === "string" ? part : (part as { uri: string }).uri))
      .join("/");
  return {
    Paths: { document: { uri: "file:///docs" } },
    Directory: jest.fn().mockImplementation((...parts: unknown[]) => ({
      uri: uriOf(parts),
      create: (...args: unknown[]) => mockMkdir(...args),
    })),
    File: jest.fn().mockImplementation((...parts: unknown[]) => ({
      uri: uriOf(parts),
      get exists() {
        return mockExists;
      },
      moveSync: (target: { uri: string }) => mockMove(uriOf(parts), target.uri),
      copySync: (target: { uri: string }) => mockCopy(uriOf(parts), target.uri),
      delete: () => mockDelete(uriOf(parts)),
    })),
  };
});

const PICKED = "file:///cache/ImagePicker/IMG_0001.jpg";
const KEPT_NAME = /^file:\/\/\/docs\/photos\/[0-9a-z]+-[0-9a-z]{8}\.jpg$/;
let KEPT = "";

/** iOS parity item 14: the picker's file sat in the purgeable cache folder
 * and its size rested on the picker's JPEG quality alone, so a queued
 * upload could lose its photo, or a big camera photo pass the bucket limit. */
describe("writeDurablePhotoFile (phone)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRendered = { width: 4032, height: 3024 };
    mockExists = true;
    mockSave.mockResolvedValue({ uri: "file:///cache/ImageManipulator/out.jpg", width: 1600, height: 1200 });
  });

  it("downscales to the longest edge, saves JPEG at the quality, and keeps it in Documents", async () => {
    KEPT = await writeDurablePhotoFile({ uri: PICKED, width: 4032, height: 3024 }, 1600, 0.72);
    expect(KEPT).toMatch(KEPT_NAME);
    expect(mockMkdir).toHaveBeenCalledWith({ intermediates: true, idempotent: true });
    expect(mockResize).toHaveBeenCalledWith({ width: 1600, height: 1200 });
    expect(mockSave).toHaveBeenCalledWith({ format: "jpeg", compress: 0.72 });
    expect(mockMove).toHaveBeenCalledWith("file:///cache/ImageManipulator/out.jpg", KEPT);
    // The picker's size was known: one render, and native memory freed.
    expect(mockRender).toHaveBeenCalledTimes(1);
    expect(mockReleaseImage).toHaveBeenCalled();
    expect(mockReleaseContext).toHaveBeenCalled();
  });

  it("re-encodes a small photo without enlarging it (the avatar's 256 px)", async () => {
    await writeDurablePhotoFile({ uri: PICKED, width: 200, height: 180 }, 256, 0.8);
    expect(mockResize).not.toHaveBeenCalled();
    expect(mockSave).toHaveBeenCalledWith({ format: "jpeg", compress: 0.8 });
  });

  it("reads the size from the image when the picker gave none (portrait)", async () => {
    mockRendered = { width: 3024, height: 4032 };
    await writeDurablePhotoFile({ uri: PICKED }, 1280, 0.6);
    expect(mockResize).toHaveBeenCalledWith({ width: 960, height: 1280 });
    expect(mockRender).toHaveBeenCalledTimes(2);
  });

  it("keeps a full-size copy when the image cannot be re-encoded", async () => {
    mockSave.mockRejectedValue(new Error("unsupported"));
    const kept = await writeDurablePhotoFile({ uri: PICKED, width: 10, height: 10 }, 1600, 0.72);
    expect(kept).toMatch(KEPT_NAME);
    expect(mockCopy).toHaveBeenCalledWith(PICKED, kept);
  });

  it("falls back to the picker's own uri when nothing can be written", async () => {
    mockSave.mockRejectedValue(new Error("unsupported"));
    mockCopy.mockImplementation(() => {
      throw new Error("disk full");
    });
    await expect(writeDurablePhotoFile({ uri: PICKED, width: 10, height: 10 }, 1600, 0.72)).resolves.toBe(
      PICKED,
    );
    mockCopy.mockReset();
  });
});

describe("durablePhotoName", () => {
  it("is the time and an eight-character random tail", () => {
    expect(durablePhotoName(0, 0)).toBe("0-00000000.jpg");
    expect(durablePhotoName(1_792_000_000_000, 0.5)).toMatch(/^[0-9a-z]+-[0-9a-z]{8}\.jpg$/);
    expect(durablePhotoName(1, 0.1)).not.toBe(durablePhotoName(1, 0.2));
  });
});

describe("downscaleSize", () => {
  it.each([
    [4032, 3024, 1600, { width: 1600, height: 1200 }],
    [3024, 4032, 1280, { width: 960, height: 1280 }],
    [1000, 1000, 256, { width: 256, height: 256 }],
  ])("%ix%i to %i", (width, height, edge, expected) => {
    expect(downscaleSize(width, height, edge)).toEqual(expected);
  });

  it("never enlarges", () => {
    expect(downscaleSize(1280, 720, 1280)).toBeNull();
    expect(downscaleSize(100, 50, 1600)).toBeNull();
  });
});

describe("releaseDurablePhoto", () => {
  const KEPT = "file:///docs/photos/abc-00000001.jpg";
  beforeEach(() => {
    jest.clearAllMocks();
    mockExists = true;
  });

  it("deletes a kept photo", () => {
    releaseDurablePhoto(KEPT);
    expect(mockDelete).toHaveBeenCalledWith(KEPT);
  });

  it("leaves anything outside the photo folder alone", () => {
    releaseDurablePhoto(PICKED);
    releaseDurablePhoto("data:image/jpeg;base64,/9j/");
    releaseDurablePhoto("https://example.test/a.jpg");
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("is quiet when the photo is already gone", () => {
    mockExists = false;
    expect(() => releaseDurablePhoto(KEPT)).not.toThrow();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
