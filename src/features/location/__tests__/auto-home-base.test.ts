import { act, renderHook } from "@testing-library/react-native";

import { HOME_BASE_TOWNS, usePrefsStore } from "@/features/onboarding";

import {
  AUTO_HOME_BASE_MAX_KM,
  AUTO_HOME_BASE_REFRESH_MS,
  nearestHomeBaseTown,
  refreshAutoHomeBase,
  useAutoHomeBase,
} from "../auto-home-base";

const mockGetPermission = jest.fn();
const mockGetLastKnown = jest.fn();
const mockGetCurrent = jest.fn();

jest.mock("expo-location", () => ({
  PermissionStatus: { GRANTED: "granted", DENIED: "denied", UNDETERMINED: "undetermined" },
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: () => mockGetPermission(),
  getLastKnownPositionAsync: () => mockGetLastKnown(),
  getCurrentPositionAsync: (options: unknown) => mockGetCurrent(options),
}));

const DAY = AUTO_HOME_BASE_REFRESH_MS;
const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);

function townById(id: string) {
  const town = HOME_BASE_TOWNS.find((candidate) => candidate.id === id);
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
    homeBase: null,
    homeBaseSource: "auto",
    homeBaseAutoCheckedAt: null,
    homeBaseTier: "off",
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPermission.mockResolvedValue({ status: "granted" });
  mockGetLastKnown.mockResolvedValue(fixAt(36.2, 44.0)); // Erbil
  resetStore();
});

describe("nearestHomeBaseTown", () => {
  it("picks the nearest town of the device location", () => {
    expect(nearestHomeBaseTown(36.21, 44.02)?.town.id).toBe("erbil");
    expect(nearestHomeBaseTown(35.57, 45.44)?.town.id).toBe("slemani");
    expect(nearestHomeBaseTown(37.2, 42.9)?.town.id).toBe("zakho");
  });

  it("returns null when the device is farther than the cap from every town", () => {
    expect(AUTO_HOME_BASE_MAX_KM).toBe(150);
    expect(nearestHomeBaseTown(52.52, 13.4)).toBeNull(); // Berlin
    expect(nearestHomeBaseTown(30.5, 47.8)).toBeNull(); // Basra
  });
});

describe("refreshAutoHomeBase", () => {
  it("sets HomeBase to the nearest town with source 'auto' and records the check", async () => {
    await expect(refreshAutoHomeBase(NOW)).resolves.toBe("updated");
    const state = usePrefsStore.getState();
    const erbil = townById("erbil");
    expect(state.homeBase).toEqual({ townId: "erbil", lat: erbil.lat, lon: erbil.lon });
    expect(state.homeBaseSource).toBe("auto");
    expect(state.homeBaseAutoCheckedAt).toBe(NOW);
  });

  it("does not touch the HomeBase alert tier", async () => {
    resetStore({ homeBaseTier: "m5" });
    await refreshAutoHomeBase(NOW);
    expect(usePrefsStore.getState().homeBaseTier).toBe("m5");
    resetStore({ homeBaseTier: "off" });
    await refreshAutoHomeBase(NOW);
    expect(usePrefsStore.getState().homeBaseTier).toBe("off");
  });

  it("runs at most once a day", async () => {
    await refreshAutoHomeBase(NOW);
    mockGetLastKnown.mockResolvedValue(fixAt(35.57, 45.44)); // moved to Slemani

    await expect(refreshAutoHomeBase(NOW + DAY - 1)).resolves.toBe("skipped");
    expect(usePrefsStore.getState().homeBase?.townId).toBe("erbil");

    await expect(refreshAutoHomeBase(NOW + DAY)).resolves.toBe("updated");
    expect(usePrefsStore.getState().homeBase?.townId).toBe("slemani");
    expect(usePrefsStore.getState().homeBaseAutoCheckedAt).toBe(NOW + DAY);
  });

  it("does nothing once the user picked a town manually, even when permission is granted", async () => {
    usePrefsStore.getState().setHomeBase({ townId: "duhok", lat: 36.87, lon: 42.99 });
    expect(usePrefsStore.getState().homeBaseSource).toBe("manual");

    await expect(refreshAutoHomeBase(NOW)).resolves.toBe("skipped");
    expect(usePrefsStore.getState().homeBase?.townId).toBe("duhok");
    expect(mockGetPermission).not.toHaveBeenCalled();
  });

  it("treats choosing 'elsewhere' as a manual choice too", async () => {
    usePrefsStore.getState().setHomeBase(null);
    await expect(refreshAutoHomeBase(NOW)).resolves.toBe("skipped");
    expect(usePrefsStore.getState().homeBase).toBeNull();
  });

  it("stops being manual after 'Use my location again' and updates right away", async () => {
    usePrefsStore.getState().setHomeBase({ townId: "duhok", lat: 36.87, lon: 42.99 });
    usePrefsStore.getState().resumeAutoHomeBase();
    expect(usePrefsStore.getState().homeBaseSource).toBe("auto");
    expect(usePrefsStore.getState().homeBaseAutoCheckedAt).toBeNull();

    await expect(refreshAutoHomeBase(NOW)).resolves.toBe("updated");
    expect(usePrefsStore.getState().homeBase?.townId).toBe("erbil");
  });

  it("keeps the old behaviour without permission: no fix is read, nothing changes, no check recorded", async () => {
    mockGetPermission.mockResolvedValue({ status: "denied" });
    await expect(refreshAutoHomeBase(NOW)).resolves.toBe("skipped");
    expect(mockGetLastKnown).not.toHaveBeenCalled();
    expect(usePrefsStore.getState().homeBase).toBeNull();
    expect(usePrefsStore.getState().homeBaseAutoCheckedAt).toBeNull();
  });

  it("falls back to a fresh balanced-accuracy fix only when nothing is cached", async () => {
    mockGetLastKnown.mockResolvedValue(null);
    mockGetCurrent.mockResolvedValue(fixAt(35.57, 45.44));
    await refreshAutoHomeBase(NOW);
    expect(mockGetCurrent).toHaveBeenCalledWith({ accuracy: 3 });
    expect(usePrefsStore.getState().homeBase?.townId).toBe("slemani");
  });

  it("leaves HomeBase alone for a device far from every town, but records the check", async () => {
    resetStore({ homeBase: { townId: "erbil", lat: 36.19, lon: 44.01 } });
    mockGetLastKnown.mockResolvedValue(fixAt(52.52, 13.4));
    await expect(refreshAutoHomeBase(NOW)).resolves.toBe("unchanged");
    expect(usePrefsStore.getState().homeBase?.townId).toBe("erbil");
    expect(usePrefsStore.getState().homeBaseAutoCheckedAt).toBe(NOW);
  });

  it("is a no-op change when already at the nearest town", async () => {
    await refreshAutoHomeBase(NOW);
    resetStore({
      homeBase: { townId: "erbil", lat: 36.19, lon: 44.01 },
      homeBaseAutoCheckedAt: NOW - 2 * DAY,
    });
    await expect(refreshAutoHomeBase(NOW)).resolves.toBe("unchanged");
    expect(usePrefsStore.getState().homeBaseAutoCheckedAt).toBe(NOW);
  });

  it("is skipped until the prefs have loaded", async () => {
    resetStore({ hasHydrated: false });
    await expect(refreshAutoHomeBase(NOW)).resolves.toBe("skipped");
    expect(mockGetPermission).not.toHaveBeenCalled();
  });

  it("drops the result if the user picked a town while the location was being read", async () => {
    mockGetLastKnown.mockImplementation(async () => {
      usePrefsStore.getState().setHomeBase({ townId: "kirkuk", lat: 35.47, lon: 44.39 });
      return fixAt(36.2, 44.0);
    });
    await expect(refreshAutoHomeBase(NOW)).resolves.toBe("skipped");
    expect(usePrefsStore.getState().homeBase?.townId).toBe("kirkuk");
  });

  it("leaves HomeBase alone when the position cannot be read", async () => {
    mockGetLastKnown.mockRejectedValue(new Error("location services off"));
    await expect(refreshAutoHomeBase(NOW)).resolves.toBe("skipped");
    expect(usePrefsStore.getState().homeBase).toBeNull();
  });
});

describe("useAutoHomeBase", () => {
  async function flush() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("sets HomeBase on mount once the prefs have loaded", async () => {
    await renderHook(() => useAutoHomeBase());
    await flush();
    expect(usePrefsStore.getState().homeBase?.townId).toBe("erbil");
  });

  it("does nothing while the prefs are still loading", async () => {
    resetStore({ hasHydrated: false });
    await renderHook(() => useAutoHomeBase());
    await flush();
    expect(mockGetPermission).not.toHaveBeenCalled();
    expect(usePrefsStore.getState().homeBase).toBeNull();
  });

  it("does nothing for a manual HomeBase", async () => {
    resetStore({ homeBaseSource: "manual", homeBase: { townId: "duhok", lat: 36.87, lon: 42.99 } });
    await renderHook(() => useAutoHomeBase());
    await flush();
    expect(mockGetPermission).not.toHaveBeenCalled();
    expect(usePrefsStore.getState().homeBase?.townId).toBe("duhok");
  });

  it("re-checks straight away when the user returns to automatic", async () => {
    resetStore({ homeBaseSource: "manual", homeBase: { townId: "duhok", lat: 36.87, lon: 42.99 } });
    await renderHook(() => useAutoHomeBase());
    await flush();
    expect(usePrefsStore.getState().homeBase?.townId).toBe("duhok");

    await act(async () => {
      usePrefsStore.getState().resumeAutoHomeBase();
    });
    await flush();
    expect(usePrefsStore.getState().homeBase?.townId).toBe("erbil");
  });
});
