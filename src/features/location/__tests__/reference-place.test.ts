import { act, renderHook } from "@testing-library/react-native";

import { MAIN_TOWNS } from "@/features/geo";
import { applyDefaultReferencePlace, usePrefsStore } from "@/features/onboarding";

import {
  REFERENCE_PLACE_MAX_KM,
  REFERENCE_PLACE_REFRESH_MS,
  nearestMainTown,
  refreshReferencePlace,
  switchToDeviceLocation,
  useReferencePlace,
} from "../reference-place";

const mockGetPermission = jest.fn();
const mockRequestPermission = jest.fn();
const mockGetLastKnown = jest.fn();
const mockGetCurrent = jest.fn();

jest.mock("expo-location", () => ({
  PermissionStatus: {
    GRANTED: "granted",
    DENIED: "denied",
    UNDETERMINED: "undetermined",
  },
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: () => mockGetPermission(),
  requestForegroundPermissionsAsync: () => mockRequestPermission(),
  getLastKnownPositionAsync: () => mockGetLastKnown(),
  getCurrentPositionAsync: (options: unknown) => mockGetCurrent(options),
}));

const DAY = REFERENCE_PLACE_REFRESH_MS;
const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);

function townById(id: string) {
  const town = MAIN_TOWNS.find((candidate) => candidate.id === id);
  if (!town) {
    throw new Error(`missing town ${id}`);
  }
  return town;
}

function fixAt(lat: number, lon: number) {
  return { coords: { latitude: lat, longitude: lon } };
}

function resetStore(overrides: Partial<ReturnType<typeof usePrefsStore.getState>> = {}) {
  usePrefsStore.setState({
    hasHydrated: true,
    referencePlace: null,
    referenceSource: "auto",
    referenceCheckedAt: null,
    anotherPlace: null,
    anotherPlaceTier: "off",
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPermission.mockResolvedValue({ status: "granted" });
  mockGetLastKnown.mockResolvedValue(fixAt(36.2, 44.0)); // Erbil
  resetStore();
});

describe("nearestMainTown", () => {
  it("picks the nearest main town to the device location", () => {
    expect(nearestMainTown(36.21, 44.02)?.town.id).toBe("erbil");
    expect(nearestMainTown(35.57, 45.44)?.town.id).toBe("slemani");
    expect(nearestMainTown(37.2, 42.9)?.town.id).toBe("zakho");
  });

  it("returns null when the device is farther than the cap from every town", () => {
    expect(REFERENCE_PLACE_MAX_KM).toBe(150);
    expect(nearestMainTown(52.52, 13.4)).toBeNull(); // Berlin
    expect(nearestMainTown(30.5, 47.8)).toBeNull(); // Basra
  });
});

describe("refreshReferencePlace", () => {
  it("sets the reference place to the nearest town and records the check", async () => {
    await expect(refreshReferencePlace(NOW)).resolves.toBe("updated");
    const state = usePrefsStore.getState();
    const erbil = townById("erbil");
    expect(state.referencePlace).toEqual({
      placeId: "erbil",
      lat: erbil.lat,
      lon: erbil.lon,
    });
    expect(state.referenceCheckedAt).toBe(NOW);
  });

  it("never touches the 'another place' choice or its alert tier", async () => {
    resetStore({
      anotherPlace: { placeId: "duhok", lat: 36.87, lon: 42.99 },
      anotherPlaceTier: "m5",
    });
    await refreshReferencePlace(NOW);
    expect(usePrefsStore.getState().anotherPlace?.placeId).toBe("duhok");
    expect(usePrefsStore.getState().anotherPlaceTier).toBe("m5");
  });

  it("runs at most once a day", async () => {
    await refreshReferencePlace(NOW);
    mockGetLastKnown.mockResolvedValue(fixAt(35.57, 45.44)); // moved to Slemani

    await expect(refreshReferencePlace(NOW + DAY - 1)).resolves.toBe("skipped");
    expect(usePrefsStore.getState().referencePlace?.placeId).toBe("erbil");

    await expect(refreshReferencePlace(NOW + DAY)).resolves.toBe("updated");
    expect(usePrefsStore.getState().referencePlace?.placeId).toBe("slemani");
    expect(usePrefsStore.getState().referenceCheckedAt).toBe(NOW + DAY);
  });

  it("does nothing without permission: no fix is read, nothing changes, no check recorded", async () => {
    mockGetPermission.mockResolvedValue({ status: "denied" });
    await expect(refreshReferencePlace(NOW)).resolves.toBe("skipped");
    expect(mockGetLastKnown).not.toHaveBeenCalled();
    expect(usePrefsStore.getState().referencePlace).toBeNull();
    expect(usePrefsStore.getState().referenceCheckedAt).toBeNull();
  });

  it("falls back to a fresh balanced-accuracy fix only when nothing is cached", async () => {
    mockGetLastKnown.mockResolvedValue(null);
    mockGetCurrent.mockResolvedValue(fixAt(35.57, 45.44));
    await refreshReferencePlace(NOW);
    expect(mockGetCurrent).toHaveBeenCalledWith({ accuracy: 3 });
    expect(usePrefsStore.getState().referencePlace?.placeId).toBe("slemani");
  });

  it("leaves the reference alone for a device far from every town, but records the check", async () => {
    resetStore({ referencePlace: { placeId: "erbil", lat: 36.19, lon: 44.01 } });
    mockGetLastKnown.mockResolvedValue(fixAt(52.52, 13.4));
    await expect(refreshReferencePlace(NOW)).resolves.toBe("unchanged");
    expect(usePrefsStore.getState().referencePlace?.placeId).toBe("erbil");
    expect(usePrefsStore.getState().referenceCheckedAt).toBe(NOW);
  });

  it("is a no-op change when already at the nearest town", async () => {
    resetStore({
      referencePlace: { placeId: "erbil", lat: 36.19, lon: 44.01 },
      referenceCheckedAt: NOW - 2 * DAY,
    });
    await expect(refreshReferencePlace(NOW)).resolves.toBe("unchanged");
    expect(usePrefsStore.getState().referenceCheckedAt).toBe(NOW);
  });

  it("is skipped until the prefs have loaded", async () => {
    resetStore({ hasHydrated: false });
    await expect(refreshReferencePlace(NOW)).resolves.toBe("skipped");
    expect(mockGetPermission).not.toHaveBeenCalled();
  });

  it("leaves the reference alone when the position cannot be read", async () => {
    mockGetLastKnown.mockRejectedValue(new Error("location services off"));
    await expect(refreshReferencePlace(NOW)).resolves.toBe("skipped");
    expect(usePrefsStore.getState().referencePlace).toBeNull();
  });
});

describe("useReferencePlace", () => {
  async function flush() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("sets the reference place on mount once the prefs have loaded", async () => {
    await renderHook(() => useReferencePlace());
    await flush();
    expect(usePrefsStore.getState().referencePlace?.placeId).toBe("erbil");
  });

  it("falls back to Hawler silently when location is not allowed", async () => {
    mockGetPermission.mockResolvedValue({ status: "denied" });
    mockGetLastKnown.mockResolvedValue(null);
    await renderHook(() => useReferencePlace());
    await flush();
    expect(usePrefsStore.getState().referencePlace?.placeId).toBe("erbil");
    expect(mockGetLastKnown).not.toHaveBeenCalled();
  });

  it("does nothing while the prefs are still loading", async () => {
    resetStore({ hasHydrated: false });
    await renderHook(() => useReferencePlace());
    await flush();
    expect(mockGetPermission).not.toHaveBeenCalled();
    expect(usePrefsStore.getState().referencePlace).toBeNull();
  });
});

describe("a manual choice", () => {
  const DUHOK = { placeId: "duhok", lat: 36.87, lon: 42.99 };

  it("is never overwritten by the location check", async () => {
    resetStore({ referencePlace: DUHOK, referenceSource: "manual" });
    // The device is in Erbil, a different town.
    await expect(refreshReferencePlace(NOW)).resolves.toBe("skipped");
    expect(mockGetLastKnown).not.toHaveBeenCalled();
    expect(usePrefsStore.getState().referencePlace).toEqual(DUHOK);
    expect(usePrefsStore.getState().referenceSource).toBe("manual");
  });

  it("wins when it is made while the fix is still being read", async () => {
    resetStore();
    let release: (value: unknown) => void = () => undefined;
    mockGetLastKnown.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const pending = refreshReferencePlace(NOW);
    await act(async () => {
      usePrefsStore.getState().chooseReferencePlace(DUHOK);
    });
    release(fixAt(36.2, 44.0));
    await expect(pending).resolves.toBe("skipped");
    expect(usePrefsStore.getState().referencePlace).toEqual(DUHOK);
  });

  it("does not get the Hawler fallback", () => {
    resetStore({ referenceSource: "manual", referencePlace: null });
    applyDefaultReferencePlace();
    expect(usePrefsStore.getState().referencePlace).toBeNull();
  });
});

describe("switchToDeviceLocation", () => {
  const DUHOK = { placeId: "duhok", lat: 36.87, lon: 42.99 };

  it("on a grant goes back to automatic and checks the location right away", async () => {
    mockRequestPermission.mockResolvedValue({ status: "granted", granted: true });
    resetStore({
      referencePlace: DUHOK,
      referenceSource: "manual",
      referenceCheckedAt: Date.now(), // checked just now: a normal refresh would skip
    });
    await expect(switchToDeviceLocation()).resolves.toBe("granted");
    const state = usePrefsStore.getState();
    expect(state.referenceSource).toBe("auto");
    expect(state.referencePlace?.placeId).toBe("erbil"); // the device is in Erbil
    expect(state.referenceCheckedAt).not.toBeNull();
  });

  it("on a refusal changes nothing", async () => {
    mockRequestPermission.mockResolvedValue({ status: "denied", granted: false });
    resetStore({ referencePlace: DUHOK, referenceSource: "manual" });
    await expect(switchToDeviceLocation()).resolves.toBe("denied");
    const state = usePrefsStore.getState();
    expect(state.referenceSource).toBe("manual");
    expect(state.referencePlace).toEqual(DUHOK);
  });

  it("treats a failing prompt as a refusal", async () => {
    mockRequestPermission.mockRejectedValue(new Error("no hardware"));
    resetStore({ referencePlace: DUHOK, referenceSource: "manual" });
    await expect(switchToDeviceLocation()).resolves.toBe("denied");
    expect(usePrefsStore.getState().referenceSource).toBe("manual");
  });
});
