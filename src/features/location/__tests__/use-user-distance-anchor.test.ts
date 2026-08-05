import { act, renderHook } from "@testing-library/react-native";

const mockGetForegroundPermissionsAsync = jest.fn();
const mockGetLastKnownPositionAsync = jest.fn();
const mockGetCurrentPositionAsync = jest.fn();

jest.mock("expo-location", () => ({
  PermissionStatus: {
    GRANTED: "granted",
    DENIED: "denied",
    UNDETERMINED: "undetermined",
  },
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: () => mockGetForegroundPermissionsAsync(),
  getLastKnownPositionAsync: () => mockGetLastKnownPositionAsync(),
  getCurrentPositionAsync: (options: unknown) => mockGetCurrentPositionAsync(options),
}));

// Imported after the mock above so the mocked module graph is in place.
// eslint-disable-next-line import/first -- see comment above
import { useUserDistanceAnchor } from "../use-user-distance-anchor";

/** Lets the hook's async permission/position chain settle before assertions
 * (same pattern as use-accelerometer-stream's test suite). */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useUserDistanceAnchor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("stays at hasFix:false and never requests a position when permission was denied", async () => {
    mockGetForegroundPermissionsAsync.mockResolvedValue({ status: "denied" });

    const { result } = await renderHook(() => useUserDistanceAnchor());
    await flush();

    expect(result.current).toEqual({ hasFix: false, lat: null, lon: null });
    expect(mockGetLastKnownPositionAsync).not.toHaveBeenCalled();
    expect(mockGetCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it("resolves a fix from the battery-friendly last-known position when permission is granted", async () => {
    mockGetForegroundPermissionsAsync.mockResolvedValue({ status: "granted" });
    mockGetLastKnownPositionAsync.mockResolvedValue({
      coords: { latitude: 36.19, longitude: 44.01 },
    });

    const { result } = await renderHook(() => useUserDistanceAnchor());
    await flush();

    expect(result.current).toEqual({ hasFix: true, lat: 36.19, lon: 44.01 });
    // Never asks for a fresh GPS fix when a cached one already exists.
    expect(mockGetCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it("falls back to a fresh fix when nothing is cached yet", async () => {
    mockGetForegroundPermissionsAsync.mockResolvedValue({ status: "granted" });
    mockGetLastKnownPositionAsync.mockResolvedValue(null);
    mockGetCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 35.56, longitude: 45.43 },
    });

    const { result } = await renderHook(() => useUserDistanceAnchor());
    await flush();

    expect(result.current).toEqual({ hasFix: true, lat: 35.56, lon: 45.43 });
    expect(mockGetCurrentPositionAsync).toHaveBeenCalledTimes(1);
  });

  it("never throws and stays at the anchor fallback if the permission check itself fails", async () => {
    mockGetForegroundPermissionsAsync.mockRejectedValue(
      new Error("no location services"),
    );

    const { result } = await renderHook(() => useUserDistanceAnchor());
    await flush();

    expect(result.current).toEqual({ hasFix: false, lat: null, lon: null });
  });
});
