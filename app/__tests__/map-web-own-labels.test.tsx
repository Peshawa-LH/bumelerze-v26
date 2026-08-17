/**
 * @jest-environment jsdom
 *
 * Web Map screen (`app/(tabs)/map.web.tsx`) — own-labels (Kurdistan city
 * labels drawn from the app's own gazetteer, `own-labels.ts`). See
 * `map-web-creation.test.tsx`'s doc comment for the jsdom-environment/
 * mocking rationale shared by every `map-web-*.test.tsx` file.
 */
import {
  act,
  cleanup,
  render,
  waitFor,
  type RenderResult,
} from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import {
  MockAttributionControl,
  mockGetRTLTextPluginStatus,
  mockMapAddLayer,
  mockMapAddSource,
  MockMap,
  mockMapGetLayoutProperty,
  MockMarker,
  mockSetRTLTextPlugin,
  mockSetWorkerUrl,
  mockSourceSetData,
  mockUseRegionEvents,
  mockUseWorldEvents,
  resetMapWebMocks,
  setMockMapStyleFixture,
  testSafeAreaMetrics,
} from "../__fixtures__/map-web-helpers";
import {
  OWN_LABELS_DEFAULT_FONT,
  OWN_LABELS_LAYER_ID,
  OWN_LABELS_SOURCE_ID,
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
    useWorldEvents: () => mockUseWorldEvents(),
  };
});

// A small, controlled fixture for the LAZY-loaded tier-3 dataset — real
// villages.json is ~5,600 records; mocking it here keeps the "does the
// lazy load actually merge in" tests fast and deterministic rather than
// asserting against real, occasionally-changing OSM data.
jest.mock("@/features/geo/data/kurdish-places-villages.json", () => [
  {
    id: "n-fixture-village",
    lat: 36.3,
    lon: 44.3,
    tier: 3,
    names: { ckb: "گوندی نموونە", kmr: "Gundê Nimûne", ar: "قرية نموذجية" },
  },
]);

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

beforeEach(() => {
  resetMapWebMocks();
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage(originalLanguage);
});

describe("MapScreenWeb own-labels (Kurdistan gazetteer city labels)", () => {
  it("adds the own-labels geojson source + symbol layer, on top of the basemap (no beforeId)", async () => {
    await renderWithProviders(<MapScreenWeb />);

    await waitFor(() => {
      expect(mockMapAddSource).toHaveBeenCalledWith(
        OWN_LABELS_SOURCE_ID,
        expect.objectContaining({ type: "geojson" }),
      );
    });

    const ownLayerCall = mockMapAddLayer.mock.calls.find(
      ([layer]) => (layer as { id: string }).id === OWN_LABELS_LAYER_ID,
    ) as [{ id: string; source: string }, string | undefined];
    expect(ownLayerCall).toBeDefined();
    const [layer, beforeId] = ownLayerCall;
    expect(layer.source).toBe(OWN_LABELS_SOURCE_ID);
    // No `beforeId` — appended last, i.e. rendered ON TOP of every basemap
    // layer. See own-labels.ts's doc comment for why that's what makes
    // MapLibre's cross-layer collision suppress the basemap's own duplicate
    // city labels (topmost layers place first).
    expect(beforeId).toBeUndefined();
  });

  it("builds the initial feature collection with Sorani names when the app boots into ckb", async () => {
    await i18n.changeLanguage("ckb");

    await renderWithProviders(<MapScreenWeb />);

    await waitFor(() => {
      expect(mockMapAddSource).toHaveBeenCalledWith(
        OWN_LABELS_SOURCE_ID,
        expect.anything(),
      );
    });
    const [, source] = mockMapAddSource.mock.calls.find(
      ([id]) => id === OWN_LABELS_SOURCE_ID,
    ) as [string, { data: { features: { properties: { label: string } }[] } }];
    const labels = source.data.features.map((f) => f.properties.label);
    // Erbil's Sorani name (gazetteer.ts) — proves the FeatureCollection was
    // built with the already-active locale at load time, not the English
    // default corrected only later.
    expect(labels).toContain("هەولێر");
  });

  it("refreshes the own-labels source data (setData) when the locale changes on a ready map", async () => {
    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => {
      expect(mockMapAddSource).toHaveBeenCalledWith(
        OWN_LABELS_SOURCE_ID,
        expect.anything(),
      );
    });
    mockSourceSetData.mockClear();

    await act(async () => {
      await i18n.changeLanguage("ckb");
    });

    await waitFor(() => {
      expect(mockSourceSetData).toHaveBeenCalledWith(
        OWN_LABELS_SOURCE_ID,
        expect.objectContaining({
          features: expect.arrayContaining([
            expect.objectContaining({
              properties: expect.objectContaining({ label: "هەولێر" }),
            }),
          ]),
        }),
      );
    });
  });

  it("borrows the basemap's own name-label text-font for the own-labels layer", async () => {
    setMockMapStyleFixture({
      layers: [
        { id: "background", type: "background" },
        { id: "roads", type: "line" },
        {
          id: "place-labels",
          type: "symbol",
          layout: {
            "text-field": ["get", "name"],
            "text-font": ["Open Sans Medium", "Noto Sans Medium"],
          },
        },
      ],
    });

    await renderWithProviders(<MapScreenWeb />);

    await waitFor(() => {
      expect(mockMapGetLayoutProperty).toHaveBeenCalledWith("place-labels", "text-font");
    });
    const ownLayerCall = mockMapAddLayer.mock.calls.find(
      ([layer]) => (layer as { id: string }).id === OWN_LABELS_LAYER_ID,
    ) as [{ layout: { "text-font": string[] } }];
    expect(ownLayerCall[0].layout["text-font"]).toEqual([
      "Open Sans Medium",
      "Noto Sans Medium",
    ]);
  });

  it("falls back to the documented default font when the style has no name-label layer at all", async () => {
    setMockMapStyleFixture({
      layers: [
        { id: "background", type: "background" },
        { id: "roads", type: "line" },
      ],
    });

    await renderWithProviders(<MapScreenWeb />);

    await waitFor(() => {
      expect(mockMapAddLayer).toHaveBeenCalledWith(
        expect.objectContaining({ id: OWN_LABELS_LAYER_ID }),
        undefined,
      );
    });
    const ownLayerCall = mockMapAddLayer.mock.calls.find(
      ([layer]) => (layer as { id: string }).id === OWN_LABELS_LAYER_ID,
    ) as [{ layout: { "text-font": string[] } }];
    expect(ownLayerCall[0].layout["text-font"]).toEqual([...OWN_LABELS_DEFAULT_FONT]);
  });

  it("builds the initial source from the MERGED gazetteer + OSM Kurdish-places core dataset, not the gazetteer alone", async () => {
    await i18n.changeLanguage("ckb");
    await renderWithProviders(<MapScreenWeb />);

    await waitFor(() => {
      expect(mockMapAddSource).toHaveBeenCalledWith(
        OWN_LABELS_SOURCE_ID,
        expect.anything(),
      );
    });
    const [, source] = mockMapAddSource.mock.calls.find(
      ([id]) => id === OWN_LABELS_SOURCE_ID,
    ) as [string, { data: { features: { properties: { label: string } }[] } }];
    const labels = source.data.features.map((f) => f.properties.label);
    // Fallujah is NOT in the gazetteer (`gazetteer.ts`) — its Sorani label
    // only exists via KURDISH_PLACES_CORE (own-labels.ts), proving the
    // initial build already uses the merged collection, before the lazy
    // village load even resolves.
    expect(labels).toContain("فەلوجە");
  });

  it("lazily loads the tier-3 village dataset and merges it into the source once it resolves", async () => {
    await i18n.changeLanguage("ckb");
    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => {
      expect(mockMapAddSource).toHaveBeenCalledWith(
        OWN_LABELS_SOURCE_ID,
        expect.anything(),
      );
    });

    await waitFor(() => {
      expect(mockSourceSetData).toHaveBeenCalledWith(
        OWN_LABELS_SOURCE_ID,
        expect.objectContaining({
          features: expect.arrayContaining([
            expect.objectContaining({
              id: "n-fixture-village",
              properties: expect.objectContaining({ label: "گوندی نموونە", tier: 3 }),
            }),
          ]),
        }),
      );
    });
  });

  it("renders the lazily-loaded villages in whichever locale is active once they resolve", async () => {
    await i18n.changeLanguage("kmr");
    await renderWithProviders(<MapScreenWeb />);

    await waitFor(() => {
      expect(mockSourceSetData).toHaveBeenCalledWith(
        OWN_LABELS_SOURCE_ID,
        expect.objectContaining({
          features: expect.arrayContaining([
            expect.objectContaining({
              id: "n-fixture-village",
              properties: expect.objectContaining({ label: "Gundê Nimûne" }),
            }),
          ]),
        }),
      );
    });
  });
});
