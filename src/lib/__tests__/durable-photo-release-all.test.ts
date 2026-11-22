/**
 * A sign-out deletes every photo kept in Documents/photos (security audit
 * APP-04): queued report, feedback and home photos, an unsaved avatar.
 */
import { releaseAllDurablePhotos } from "../durable-photo-file";

const mockDelete = jest.fn();
let mockFolderExists = true;
const mockDirectory = jest.fn();
jest.mock("expo-file-system", () => ({
  Paths: { document: { uri: "file:///docs" } },
  Directory: jest.fn().mockImplementation((...parts: unknown[]) => {
    mockDirectory(...parts);
    return {
      get exists() {
        return mockFolderExists;
      },
      delete: () => mockDelete(),
    };
  }),
  File: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockFolderExists = true;
});

it("deletes the whole photo folder in Documents", () => {
  releaseAllDurablePhotos();
  expect(mockDirectory).toHaveBeenCalledWith({ uri: "file:///docs" }, "photos");
  expect(mockDelete).toHaveBeenCalledTimes(1);
});

it("does nothing when there is no folder yet", () => {
  mockFolderExists = false;
  releaseAllDurablePhotos();
  expect(mockDelete).not.toHaveBeenCalled();
});

it("never throws", () => {
  mockDelete.mockImplementationOnce(() => {
    throw new Error("busy");
  });
  expect(() => releaseAllDurablePhotos()).not.toThrow();
});
