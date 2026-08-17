/**
 * @jest-environment jsdom
 *
 * Web Map screen (`app/(tabs)/map.web.tsx`) — terrain hillshade insertion,
 * label localization by locale, and the MapTiler→OpenFreeMap runtime
 * fallback. See `map-web-creation.test.tsx`'s doc comment for the
 * jsdom-environment/mocking rationale.
 */
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  type RenderResult,
} from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import {
  MockAttributionControl,
  mockMapAddLayer,
  mockMapAddSource,
  mockMapConstructorOptions,
  MockMap,
  mockMapSetLayoutProperty,
  MockMarker,
  mockGetRTLTextPluginStatus,
  mockSetRTLTextPlugin,
  mockSetWorkerUrl,
  mockUseRegionEvents,
  resetMapWebMocks,
  setMockMapErrorQueue,
  setMockMapStyleFixture,
  testSafeAreaMetrics,
} from "../__fixtures__/map-web-helpers";
import {
  OWN_LABELS_SOURCE_ID,
  TERRAIN_DEM_SOURCE_ID,
  TERRAIN_HILLSHADE_LAYER_ID,
} from "@/features/map";

jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require required inside a jest.mock factory
  const { useEffect } = require("react");
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(() => effect(), [effect]);
    },
    useRouter: () => ({ push: jest.fn() }),
  };
});

jest.mock("@/features/events", () => {
  const actual = jest.requireActual("@/features/events");
  return {
    ...actual,
    useRegionEvents: () => mockUseRegionEvents(),
  };
});

// `{ virtual: true }`: maplibre-gl ships ESM-only — see
// map-web-creation.test.tsx.
jest.mock(
  "maplibre-gl",
  () => ({
    Map: MockMap,
    Marker: MockMarker,
    AttributionControl: MockAttributionControl,
    setWorkerUrl: mockSetWorkerUrl,
    setRTLTextPlugin: mockSetRTLTextPlugin,
    getRTLTextPluginStatus: mockGetRTLTextPluginStatus,
  }),
  { virtual: true },
);

// Imported after the mocks above so the mocked module graph is in place.
// eslint-disable-next-line import/first -- see comment above
import MapScreenWeb from "../(tabs)/map.web";

async function renderWithProviders(ui: ReactElement): Promise<RenderResult> {
  return render(
    <SafeAreaProvider initialMetrics={testSafeAreaMetrics}>{ui}</SafeAreaProvider>,
  );
}

const originalLanguage = i18n.language;
const originalMapTilerKey = process.env.EXPO_PUBLIC_MAPTILER_KEY;

beforeEach(() => {
  resetMapWebMocks();
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage(originalLanguage);
  if (originalMapTilerKey === undefined) {
    delete process.env.EXPO_PUBLIC_MAPTILER_KEY;
  } else {
    process.env.EXPO_PUBLIC_MAPTILER_KEY = originalMapTilerKey;
  }
});

describe("MapScreenWeb terrain hillshade", () => {
  it("adds the terrain DEM source + hillshade layer, before the first line/symbol layer", async () => {
    await renderWithProviders(<MapScreenWeb />);

    // Two sources/layers get added on a fresh load: terrain hillshade AND
    // the own-labels gazetteer layer (`map-web-own-labels.test.tsx` covers
    // the latter in full) — this test only cares about the terrain half.
    await waitFor(() => {
      expect(mockMapAddSource).toHaveBeenCalledTimes(2);
    });
    expect(mockMapAddSource).toHaveBeenCalledWith(
      TERRAIN_DEM_SOURCE_ID,
      expect.objectContaining({ type: "raster-dem", encoding: "terrarium" }),
    );

    expect(mockMapAddLayer).toHaveBeenCalledTimes(2);
    const terrainCall = mockMapAddLayer.mock.calls.find(
      ([layer]) => (layer as { id: string }).id === TERRAIN_HILLSHADE_LAYER_ID,
    ) as [{ id: string }, string];
    expect(terrainCall).toBeDefined();
    const [layer, beforeId] = terrainCall;
    expect(layer.id).toBe(TERRAIN_HILLSHADE_LAYER_ID);
    // The fixture style's layers are background/land(fill)/roads(line)/
    // place-labels(symbol) — "roads" is the first line-or-symbol layer, so
    // hillshade goes above the fill but below every line/label.
    expect(beforeId).toBe("roads");
  });

  it("skips adding a second hillshade when the style already ships a raster-dem source", async () => {
    setMockMapStyleFixture({
      sources: { openmaptiles: { type: "vector" }, terrain: { type: "raster-dem" } },
    });

    await renderWithProviders(<MapScreenWeb />);

    // Let the "load" handler (and its terrain/label priming) settle.
    await waitFor(() => {
      expect(mockMapConstructorOptions).toHaveLength(1);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // No SECOND raster-dem/hillshade — but the own-labels source/layer
    // still gets added regardless of terrain (an unrelated concern).
    expect(mockMapAddSource).not.toHaveBeenCalledWith(
      TERRAIN_DEM_SOURCE_ID,
      expect.anything(),
    );
    expect(mockMapAddLayer).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: TERRAIN_HILLSHADE_LAYER_ID }),
      expect.anything(),
    );
    expect(mockMapAddSource).toHaveBeenCalledWith(
      OWN_LABELS_SOURCE_ID,
      expect.objectContaining({ type: "geojson" }),
    );
  });
});

describe("MapScreenWeb label localization", () => {
  it("leaves the default text-field alone for a non-Arabic-script locale (en)", async () => {
    await renderWithProviders(<MapScreenWeb />);

    await waitFor(() => {
      expect(mockMapSetLayoutProperty).toHaveBeenCalled();
    });
    // Restores/keeps the layer's OWN original text-field, not the Arabic one.
    const [layerId, name, value] = mockMapSetLayoutProperty.mock.calls[0] as [
      string,
      string,
      unknown,
    ];
    expect(layerId).toBe("place-labels");
    expect(name).toBe("text-field");
    expect(value).toEqual(["get", "name"]);
  });

  it("switches name-labeling layers to coalesce(name:ar, name) for ckb", async () => {
    await i18n.changeLanguage("ckb");

    await renderWithProviders(<MapScreenWeb />);

    await waitFor(() => {
      expect(mockMapSetLayoutProperty).toHaveBeenCalled();
    });
    const lastCall = mockMapSetLayoutProperty.mock.calls.at(-1) as [
      string,
      string,
      unknown,
    ];
    expect(lastCall[0]).toBe("place-labels");
    expect(lastCall[2]).toEqual(["coalesce", ["get", "name:ar"], ["get", "name"]]);
  });

  it("re-applies localization when the locale changes on an already-ready map", async () => {
    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => {
      expect(mockMapSetLayoutProperty).toHaveBeenCalled();
    });
    mockMapSetLayoutProperty.mockClear();

    await act(async () => {
      await i18n.changeLanguage("ar");
    });

    await waitFor(() => {
      expect(mockMapSetLayoutProperty).toHaveBeenCalledWith(
        "place-labels",
        "text-field",
        ["coalesce", ["get", "name:ar"], ["get", "name"]],
      );
    });

    mockMapSetLayoutProperty.mockClear();
    await act(async () => {
      await i18n.changeLanguage("en");
    });

    await waitFor(() => {
      expect(mockMapSetLayoutProperty).toHaveBeenCalledWith(
        "place-labels",
        "text-field",
        ["get", "name"],
      );
    });
  });
});

describe("MapScreenWeb MapTiler → OpenFreeMap runtime fallback", () => {
  it("silently recreates the map on OpenFreeMap after a MapTiler style failure, exactly once", async () => {
    process.env.EXPO_PUBLIC_MAPTILER_KEY = "test-key";
    // First (MapTiler) instance fails before ever loading; the automatic
    // fallback's second (OpenFreeMap) instance succeeds.
    setMockMapErrorQueue([true, false]);

    await renderWithProviders(<MapScreenWeb />);

    await waitFor(() => {
      expect(mockMapConstructorOptions).toHaveLength(2);
    });
    const [firstOptions, secondOptions] = mockMapConstructorOptions as {
      style: string;
    }[];
    expect(firstOptions?.style).toContain("api.maptiler.com");
    expect(secondOptions?.style).toContain("tiles.openfreemap.org");

    // The map never shows the offline/error state — the fallback was
    // silent and the second instance reached "load" successfully. Terrain
    // + own-labels priming ran against that second, now-live instance too.
    await waitFor(() => {
      expect(mockMapAddSource).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByText(i18n.t("map.offlineTitle"))).toBeNull();
  });

  it("shows the offline state (does not loop) when OpenFreeMap ALSO fails after the fallback", async () => {
    process.env.EXPO_PUBLIC_MAPTILER_KEY = "test-key";
    setMockMapErrorQueue([true, true]);

    await renderWithProviders(<MapScreenWeb />);

    await waitFor(() => {
      expect(screen.getByText(i18n.t("map.offlineTitle"))).toBeTruthy();
    });
    // Exactly one fallback attempt: MapTiler instance + the one OpenFreeMap
    // retry, never a third.
    expect(mockMapConstructorOptions).toHaveLength(2);
  });
});
