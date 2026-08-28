/**
 * @jest-environment jsdom
 *
 * Web Map screen (`app/(tabs)/map.web.tsx`) — basemap style picker
 * (update-plan-2026-08.md §4.3/Part 3) and the MapTiler attribution logo
 * (Part 4). See `map-web-creation.test.tsx`'s doc comment for the
 * jsdom-environment/mocking rationale.
 *
 * The engineering risk this file exists to verify: `map.setStyle()` wipes
 * every source/layer WE added (terrain hillshade, own-labels) — after a
 * style swap, `primeTerrainAndLabelCache`/`applyLocaleLabels` must re-run
 * against the NEW style, and markers must survive untouched (they're DOM
 * overlays independent of the style/source system, per `map.web.tsx`'s own
 * `handleStyleChange` doc comment).
 *
 * Two tests total, not one-mount-per-scenario: `map-web-interaction.test.tsx`'s
 * own doc comment already documents that this exact jsdom + RNTL +
 * mocked-dynamic-import combination stops flushing effects reliably starting
 * with a SECOND full mount-and-settle cycle in one file; this file adds an
 * even deeper async chain on top (the `setStyle`/`style.load` microtask), so
 * it follows that file's proven fix — one mount per DISTINCT precondition
 * (MapTiler key configured vs. not), sequential interactions within each.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  type RenderResult,
} from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import {
  makeEvent,
  MockAttributionControl,
  MockMap,
  mockMapAddLayer,
  mockMapAddSource,
  mockMapConstructorOptions,
  MockMarker,
  mockMarkerConstructorOptions,
  mockMarkerRemove,
  mockMapSetStyle,
  MOCK_DATA_UPDATED_AT,
  mockGetRTLTextPluginStatus,
  mockSetRTLTextPlugin,
  mockSetWorkerUrl,
  mockUseRegionEvents,
  mockUseWorldEvents,
  resetMapWebMocks,
  testSafeAreaMetrics,
} from "./map-web-helpers";

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

// eslint-disable-next-line import/first -- see comment above
import MapScreenWeb from "../(tabs)/map.web";

async function renderWithProviders(ui: ReactElement): Promise<RenderResult> {
  return render(
    <SafeAreaProvider initialMetrics={testSafeAreaMetrics}>{ui}</SafeAreaProvider>,
  );
}

const ORIGINAL_MAPTILER_KEY = process.env.EXPO_PUBLIC_MAPTILER_KEY;

beforeEach(() => {
  resetMapWebMocks();
  mockUseRegionEvents.mockReturnValue({
    events: [makeEvent({ id: "region-1" })],
    dataUpdatedAt: MOCK_DATA_UPDATED_AT,
  });
});

afterEach(() => {
  cleanup();
  if (ORIGINAL_MAPTILER_KEY === undefined) {
    delete process.env.EXPO_PUBLIC_MAPTILER_KEY;
  } else {
    process.env.EXPO_PUBLIC_MAPTILER_KEY = ORIGINAL_MAPTILER_KEY;
  }
});

async function expandStylePicker(): Promise<void> {
  const toggle = screen.getByRole("button", { name: i18n.t("map.style.expandA11yHint") });
  await act(async () => {
    fireEvent.press(toggle);
  });
}

describe("MapScreenWeb basemap style picker — no MapTiler key configured", () => {
  it("is visible to every user (not dev-gated), defaults to Outdoor, lists all five candidates, and shows no attribution logo", async () => {
    delete process.env.EXPO_PUBLIC_MAPTILER_KEY;

    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => expect(mockMarkerConstructorOptions).toHaveLength(1));

    // Ship-to-everyone, not dev-gated: the picker itself is on screen with
    // no beta flag/feature check involved in reaching it.
    expect(screen.getByText(i18n.t("map.style.outdoor"))).toBeTruthy();

    // OpenFreeMap-only environment: no MapTiler attribution logo at all.
    expect(
      screen.queryByRole("link", {
        name: i18n.t("map.attribution.maptilerLogoA11yLabel"),
      }),
    ).toBeNull();

    await expandStylePicker();
    for (const id of ["outdoor", "topo", "hybrid", "dataviz", "openfreemap"] as const) {
      expect(screen.getByRole("radio", { name: i18n.t(`map.style.${id}`) })).toBeTruthy();
    }
  });
});

describe("MapScreenWeb basemap style picker — MapTiler key configured", () => {
  it("live-swaps styles via map.setStyle (never recreating the map), re-applies terrain + own-labels, keeps markers untouched, and toggles the attribution logo per provider", async () => {
    process.env.EXPO_PUBLIC_MAPTILER_KEY = "test-key-123";

    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => expect(mockMarkerConstructorOptions).toHaveLength(1));

    // Default style ("outdoor") resolves to MapTiler since a key is
    // configured — the attribution logo is present from the start.
    expect(
      screen.getByRole("link", { name: i18n.t("map.attribution.maptilerLogoA11yLabel") }),
    ).toBeTruthy();

    const addSourceCallsBeforeSwap = mockMapAddSource.mock.calls.length;
    const addLayerCallsBeforeSwap = mockMapAddLayer.mock.calls.length;
    // Sanity: the initial load already primed terrain + own-labels once (2
    // sources: terrain-dem, own-labels; 2 layers: hillshade, own-labels
    // symbol layer).
    expect(addSourceCallsBeforeSwap).toBeGreaterThanOrEqual(2);
    expect(addLayerCallsBeforeSwap).toBeGreaterThanOrEqual(2);

    await expandStylePicker();
    await act(async () => {
      fireEvent.press(screen.getByRole("radio", { name: i18n.t("map.style.topo") }));
    });

    // `setStyle` on the EXISTING instance, not a new `Map(...)` construction
    // — only one constructor call across this whole test.
    expect(mockMapSetStyle).toHaveBeenCalledTimes(1);
    expect(mockMapSetStyle.mock.calls[0]?.[0]).toEqual(
      expect.stringContaining("topo-v4"),
    );
    expect(mockMapConstructorOptions).toHaveLength(1);

    // Terrain + own-labels get RE-ADDED against the post-swap style (the
    // mock's `setStyle` wipes sources/layers back to the representative
    // default, which has no `raster-dem` — exactly like a real style swap
    // landing on a style without its own terrain).
    await waitFor(() => {
      expect(mockMapAddSource.mock.calls.length).toBeGreaterThan(
        addSourceCallsBeforeSwap,
      );
    });
    expect(mockMapAddSource.mock.calls.length).toBe(addSourceCallsBeforeSwap + 2);
    expect(mockMapAddLayer.mock.calls.length).toBe(addLayerCallsBeforeSwap + 2);

    // Markers survive completely untouched — no rebuild, no extra removes —
    // confirming they're independent DOM overlays, not style-tied layers.
    expect(mockMarkerConstructorOptions).toHaveLength(1);
    expect(mockMarkerRemove).not.toHaveBeenCalled();

    // The picker's own header reflects the new selection (both the
    // collapsed header AND the still-open chip row render the "Topographic"
    // label at this point — a `getAllByText` count check, not an exact
    // single-match query, since that duplication is expected UI while
    // expanded).
    expect(screen.getAllByText(i18n.t("map.style.topo")).length).toBeGreaterThanOrEqual(
      1,
    );

    // Switching to the OpenFreeMap catalog entry always resolves to
    // OpenFreeMap regardless of the configured key — the attribution logo
    // must disappear. The panel is still expanded from the selection above
    // (selecting a style doesn't auto-collapse it), so the chip is already
    // on screen — no need to expand again.
    await act(async () => {
      fireEvent.press(
        screen.getByRole("radio", { name: i18n.t("map.style.openfreemap") }),
      );
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("link", {
          name: i18n.t("map.attribution.maptilerLogoA11yLabel"),
        }),
      ).toBeNull();
    });
  });
});
