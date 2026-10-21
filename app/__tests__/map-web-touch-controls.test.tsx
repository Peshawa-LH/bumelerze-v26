/**
 * @jest-environment jsdom
 *
 * Web Map screen (`app/(tabs)/(map)/map.web.tsx`) — MapLibre's stock
 * controls are 29 px buttons, a 24 px attribution toggle and 14 px-tall
 * credit links (review A-9/B-12). The screen scopes a small stylesheet to
 * its own container so every control on THIS map reaches the 44 pt tap
 * minimum. See `map-web-creation.test.tsx`'s doc comment for the
 * jsdom-environment/mocking rationale shared by every map test file.
 */
import { cleanup, render, waitFor, type RenderResult } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import {
  makeEvent,
  MockAttributionControl,
  MockMap,
  MockMarker,
  mockGetRTLTextPluginStatus,
  MOCK_DATA_UPDATED_AT,
  mockMapAddControl,
  mockSetRTLTextPlugin,
  mockSetWorkerUrl,
  mockUseRegionEvents,
  mockUseWorldEvents,
  resetMapWebMocks,
  testSafeAreaMetrics,
} from "@/features/map/__fixtures__/map-web-helpers";

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
import MapScreenWeb from "@/features/map/WebMapTab.web";

const CONTAINER_CLASS = "bml-map-touch-controls";
const STYLE_ID = "bml-map-touch-controls-css";

/** Every host element of `type` in the rendered JSON tree. */
function hostElements(
  node: ReturnType<RenderResult["toJSON"]>,
  type: string,
): { props: Record<string, unknown> }[] {
  if (node == null || typeof node === "string") {
    return [];
  }
  const own = node.type === type ? [{ props: node.props as Record<string, unknown> }] : [];
  const children = (node.children ?? []) as ReturnType<RenderResult["toJSON"]>[];
  return own.concat(...children.map((child) => hostElements(child, type)));
}

async function renderWithProviders(ui: ReactElement): Promise<RenderResult> {
  return render(
    <SafeAreaProvider initialMetrics={testSafeAreaMetrics}>{ui}</SafeAreaProvider>,
  );
}

beforeEach(() => {
  resetMapWebMocks();
  mockUseRegionEvents.mockReturnValue({
    events: [makeEvent({ id: "region-1" })],
    dataUpdatedAt: MOCK_DATA_UPDATED_AT,
  });
});

afterEach(() => {
  cleanup();
});

describe("MapScreenWeb 44 pt MapLibre controls (review A-9/B-12)", () => {
  it("scopes the rules to its own container's class and adds them once the map is created", async () => {
    const view = await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => {
      expect(mockMapAddControl).toHaveBeenCalled();
    });

    const container = hostElements(view.toJSON(), "div").find(
      (node) => node.props.className === CONTAINER_CLASS,
    );
    expect(container).toBeTruthy();

    const css = document.getElementById(STYLE_ID)?.textContent ?? "";
    // Group buttons (zoom, if ever added here) become 44 px squares.
    expect(css).toContain(
      `.${CONTAINER_CLASS} .maplibregl-ctrl-group button { width: 44px; height: 44px; }`,
    );
    // The compact attribution pill is a 44 px circle when closed...
    expect(css).toContain(
      `.${CONTAINER_CLASS} .maplibregl-ctrl-attrib.maplibregl-compact { min-height: 44px; padding: 0 44px 0 0;`,
    );
    expect(css).toContain(
      `.${CONTAINER_CLASS} .maplibregl-ctrl-attrib-button { width: 44px; height: 44px;`,
    );
    // The stock 24 px icon must not tile across the bigger button.
    expect(css).toMatch(
      /maplibregl-ctrl-attrib-button \{[^}]*background-repeat: no-repeat;[^}]*background-size: 24px 24px;/,
    );
    // ...and each credit link is a 44 px-tall block once it is open.
    expect(css).toContain(
      `.${CONTAINER_CLASS} .maplibregl-ctrl-attrib a { display: inline-block; min-height: 44px; line-height: 44px; }`,
    );
    // Every rule is scoped: nothing restyles the stations/handbook/pin maps.
    for (const line of css.split("\n").filter((entry) => entry.trim().length > 0)) {
      expect(line.startsWith(`.${CONTAINER_CLASS} `)).toBe(true);
    }
  });

  it("adds the stylesheet only once across remounts", async () => {
    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => {
      expect(mockMapAddControl).toHaveBeenCalled();
    });
    cleanup();
    resetMapWebMocks();
    mockUseRegionEvents.mockReturnValue({
      events: [makeEvent({ id: "region-1" })],
      dataUpdatedAt: MOCK_DATA_UPDATED_AT,
    });
    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => {
      expect(mockMapAddControl).toHaveBeenCalled();
    });

    expect(document.querySelectorAll(`#${STYLE_ID}`)).toHaveLength(1);
  });
});
