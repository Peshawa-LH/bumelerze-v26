import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement, ReactNode } from "react";
import { TurboModuleRegistry } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useMapPreferencesStore } from "@/features/map/preferences-store";
import i18n, { isRTLLocale } from "@/i18n";

import MapScreen from "../(tabs)/(map)/map";

/**
 * Native (iOS/Android) Map tab — resolved by Metro's platform extension
 * rules for any non-web build (`map.web.tsx` is web-only, never bundled
 * here). Without MapLibre's native code (Expo Go, and this jest run unless a
 * test says otherwise) it is a real translated state, not a TODO string —
 * asserted in both an RTL and an LTR locale; full key-parity across all four
 * locales is already enforced repo-wide by `src/i18n/__tests__/locales.test.ts`.
 * With the native code present it is a MapLibre Native map on the web's
 * basemap and first view.
 */
const testSafeAreaMetrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderWithProviders(ui: ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={testSafeAreaMetrics}>{ui}</SafeAreaProvider>,
  );
}

interface MockMapProps {
  mapStyle: string;
  logo?: boolean;
  attribution?: boolean;
  ref?: import("react").Ref<{ showAttribution: () => Promise<void> }>;
  onDidFinishLoadingMap?: () => void;
  onDidFailLoadingMap?: () => void;
  children?: ReactNode;
}

interface MockCameraProps {
  initialViewState?: {
    bounds?: [number, number, number, number];
    padding?: Record<string, number>;
  };
}

const mockMapRenders: MockMapProps[] = [];
const mockCameraRenders: MockCameraProps[] = [];
const mockShowAttribution = jest.fn(async () => undefined);

jest.mock("@maplibre/maplibre-react-native", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    Map: (props: MockMapProps) => {
      mockMapRenders.push(props);
      React.useImperativeHandle(props.ref, () => ({ showAttribution: mockShowAttribution }));
      return React.createElement(View, { testID: "native-map" }, props.children);
    },
    Camera: (props: MockCameraProps) => {
      mockCameraRenders.push(props);
      return null;
    },
  };
});

function lastMapProps(): MockMapProps {
  const props = mockMapRenders[mockMapRenders.length - 1];
  if (!props) {
    throw new Error("the native map was never rendered");
  }
  return props;
}

const ORIGINAL_MAPTILER_KEY = process.env.EXPO_PUBLIC_MAPTILER_KEY;

function setMapTilerKey(value: string | undefined): void {
  // Same `process.env` object, never a replacement: the transformed
  // modules keep a reference to it from import time.
  if (value === undefined) {
    delete process.env.EXPO_PUBLIC_MAPTILER_KEY;
  } else {
    process.env.EXPO_PUBLIC_MAPTILER_KEY = value;
  }
}

describe("Native Map tab placeholder (no MapLibre native code, e.g. Expo Go)", () => {
  const originalLanguage = i18n.language;

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage(originalLanguage);
  });

  it("renders the Sorani (RTL) translated 'arrives with the app build' state", async () => {
    expect(isRTLLocale("ckb")).toBe(true);

    await i18n.changeLanguage("ckb");
    await renderWithProviders(<MapScreen />);

    expect(screen.getByText(i18n.t("map.title"))).toBeTruthy();
    expect(screen.getByText(i18n.t("map.nativeUnavailableDescription"))).toBeTruthy();
  });

  it("renders the English (LTR) translated state for comparison", async () => {
    expect(isRTLLocale("en")).toBe(false);

    await i18n.changeLanguage("en");
    await renderWithProviders(<MapScreen />);

    expect(screen.getByText("Map")).toBeTruthy();
    expect(
      screen.getByText(
        "Bumelerze's live map needs a full app installation to run. It's on the way. Check the event list for the latest earthquakes in the meantime.",
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId("native-map")).toBeNull();
  });
});

describe("Native Map tab with MapLibre's native code", () => {
  beforeEach(async () => {
    mockMapRenders.length = 0;
    mockCameraRenders.length = 0;
    jest
      .spyOn(TurboModuleRegistry, "get")
      .mockImplementation((name: string) =>
        name === "MLRNMapViewModule" ? ({} as never) : null,
      );
    useMapPreferencesStore.setState({ styleId: "outdoor", hasHydrated: true });
    await i18n.changeLanguage("en");
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    setMapTilerKey(ORIGINAL_MAPTILER_KEY);
  });

  it("shows the MapTiler basemap the web uses, framed on the region like the web map", async () => {
    setMapTilerKey("test-key");
    await renderWithProviders(<MapScreen />);

    expect(screen.getByTestId("native-map")).toBeTruthy();
    expect(lastMapProps().mapStyle).toMatch(
      /^https:\/\/api\.maptiler\.com\/maps\/outdoor-v4(-dark)?\/style\.json\?key=test-key$/,
    );
    expect(lastMapProps().logo).toBe(false);
    expect(mockCameraRenders[mockCameraRenders.length - 1]?.initialViewState).toEqual({
      bounds: [41, 33, 48.5, 38.5],
      padding: { top: 32, right: 32, bottom: 32, left: 32 },
    });
  });

  it("[regression] opens the map credits from its own 44 pt button instead of MapLibre's 26 pt (i)", async () => {
    setMapTilerKey("test-key");
    await renderWithProviders(<MapScreen />);
    // MapLibre's own button followed the phone's direction and ended up
    // under the MapTiler logo on a Sorani phone.
    expect(lastMapProps().attribution).toBe(false);
    expect(screen.queryByLabelText("Map credits")).toBeNull();

    await act(async () => {
      lastMapProps().onDidFinishLoadingMap?.();
    });
    const credits = screen.getByLabelText("Map credits");
    expect(credits).toHaveStyle({ width: 44, height: 44 });

    await act(async () => {
      fireEvent.press(credits);
    });
    expect(mockShowAttribution).toHaveBeenCalledTimes(1);
  });

  it("uses OpenFreeMap when no MapTiler key is configured", async () => {
    setMapTilerKey(undefined);
    await renderWithProviders(<MapScreen />);

    expect(lastMapProps().mapStyle).toMatch(/^https:\/\/tiles\.openfreemap\.org\/styles\//);
  });

  it("covers the map with 'Loading map…' until the style has loaded", async () => {
    setMapTilerKey("test-key");
    await renderWithProviders(<MapScreen />);
    expect(screen.getByText("Loading map…")).toBeTruthy();

    await act(async () => {
      lastMapProps().onDidFinishLoadingMap?.();
    });

    expect(screen.queryByText("Loading map…")).toBeNull();
  });

  it("falls back to OpenFreeMap once, then shows the offline state with a Retry that starts over", async () => {
    setMapTilerKey("test-key");
    await renderWithProviders(<MapScreen />);

    await act(async () => {
      lastMapProps().onDidFailLoadingMap?.();
    });
    expect(lastMapProps().mapStyle).toMatch(/openfreemap/);

    await act(async () => {
      lastMapProps().onDidFailLoadingMap?.();
    });
    expect(screen.getByText("Map unavailable offline")).toBeTruthy();
    expect(screen.queryByTestId("native-map")).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByText("Retry"));
    });
    expect(lastMapProps().mapStyle).toMatch(/api\.maptiler\.com/);
  });

  it("waits for the saved style choice before creating the map", async () => {
    setMapTilerKey("test-key");
    useMapPreferencesStore.setState({ styleId: "topo", hasHydrated: false });
    await renderWithProviders(<MapScreen />);
    expect(screen.queryByTestId("native-map")).toBeNull();

    await act(async () => {
      useMapPreferencesStore.setState({ hasHydrated: true });
    });

    expect(lastMapProps().mapStyle).toMatch(/\/maps\/topo-v4(-dark)?\//);
  });
});
