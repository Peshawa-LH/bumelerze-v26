import { HOME_PHOTO_JPEG_QUALITY, HOME_PHOTO_MAX_EDGE_PX, pickHomePhoto } from "../photos";

const mockLibrary = jest.fn();
const mockCamera = jest.fn();
const mockCameraPermission = jest.fn();
jest.mock("expo-image-picker", () => ({
  MediaTypeOptions: { Images: "Images" },
  launchImageLibraryAsync: (...args: unknown[]) => mockLibrary(...args),
  launchCameraAsync: (...args: unknown[]) => mockCamera(...args),
  requestCameraPermissionsAsync: () => mockCameraPermission(),
}));

const mockDurable = jest.fn();
jest.mock("@/lib/durable-photo-uri", () => ({
  toDurablePhotoUri: (...args: unknown[]) => mockDurable(...args),
  dataUriMimeType: () => null,
}));

const ASSET = { uri: "file:///cache/ImagePicker/a.jpg", width: 4032, height: 3024 };

/** iOS parity item 14: a home photo is shrunk to the web's size on the phone
 * too, and encoded once (the picker no longer pre-compresses it to 0.4). */
describe("pickHomePhoto", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDurable.mockResolvedValue("file:///docs/photos/x.jpg");
    mockCameraPermission.mockResolvedValue({ granted: true });
    mockLibrary.mockResolvedValue({ canceled: false, assets: [ASSET] });
    mockCamera.mockResolvedValue({ canceled: false, assets: [ASSET] });
  });

  it("takes the library photo at full quality and keeps it at 1280 px, JPEG 0.6", async () => {
    await expect(pickHomePhoto("library")).resolves.toBe("file:///docs/photos/x.jpg");
    expect(mockLibrary).toHaveBeenCalledWith(expect.objectContaining({ quality: 1 }));
    expect(mockDurable).toHaveBeenCalledWith(ASSET, { maxEdgePx: 1280, quality: 0.6 });
    expect(HOME_PHOTO_MAX_EDGE_PX).toBe(1280);
    expect(HOME_PHOTO_JPEG_QUALITY).toBe(0.6);
  });

  it("does the same for a camera photo", async () => {
    await expect(pickHomePhoto("camera")).resolves.toBe("file:///docs/photos/x.jpg");
    expect(mockCamera).toHaveBeenCalledWith(expect.objectContaining({ quality: 1 }));
    expect(mockDurable).toHaveBeenCalledWith(ASSET, { maxEdgePx: 1280, quality: 0.6 });
  });

  it("returns nothing when the camera is refused or the picker is closed", async () => {
    mockCameraPermission.mockResolvedValue({ granted: false });
    await expect(pickHomePhoto("camera")).resolves.toBeNull();
    mockLibrary.mockResolvedValue({ canceled: true, assets: [] });
    await expect(pickHomePhoto("library")).resolves.toBeNull();
    expect(mockDurable).not.toHaveBeenCalled();
  });
});
