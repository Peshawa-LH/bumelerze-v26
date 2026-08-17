/**
 * @jest-environment jsdom
 *
 * Web Map screen (`app/(tabs)/map.web.tsx`) — the offline/error state and
 * retry. See `map-web-creation.test.tsx`'s doc comment for the
 * jsdom-environment/mocking rationale.
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
  MockAttributionControl,
  mockMapConstructorOptions,
  MockMap,
  mockMapRemove,
  MockMarker,
  mockGetRTLTextPluginStatus,
  mockSetRTLTextPlugin,
  mockSetWorkerUrl,
  mockUseRegionEvents,
  resetMapWebMocks,
  setMockNextMapShouldError,
  testSafeAreaMetrics,
} from "../__fixtures__/map-web-helpers";

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
  // `render` is async in this installed `@testing-library/react-native`
  // version (14.x) — must be awaited.
  return render(
    <SafeAreaProvider initialMetrics={testSafeAreaMetrics}>{ui}</SafeAreaProvider>,
  );
}

beforeEach(() => {
  resetMapWebMocks();
});

afterEach(() => {
  cleanup();
});

describe("MapScreenWeb offline/error state", () => {
  it("shows the offline state (not a blank map) when the style/tiles fail to load", async () => {
    setMockNextMapShouldError(true);

    await renderWithProviders(<MapScreenWeb />);

    await waitFor(() => {
      expect(screen.getByText(i18n.t("map.offlineTitle"))).toBeTruthy();
    });
    expect(screen.getByText(i18n.t("map.offlineDescription"))).toBeTruthy();
  });

  it("retries by tearing down and recreating the map", async () => {
    setMockNextMapShouldError(true);

    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => {
      expect(screen.getByText(i18n.t("map.offlineTitle"))).toBeTruthy();
    });

    // The retry itself should succeed this time.
    setMockNextMapShouldError(false);
    const retryButton = screen.getByRole("button", { name: i18n.t("map.retry") });
    await act(async () => {
      fireEvent.press(retryButton);
      // A few deterministic microtask ticks for the retried
      // `import("maplibre-gl")` chain to resolve — a bare `waitFor` here
      // was flaky in this exact jsdom + mocked-dynamic-import combination
      // (a second full async settle within one file/test), this direct
      // drain was the reliable alternative.
      for (let i = 0; i < 10; i += 1) {
        await Promise.resolve();
      }
    });

    expect(mockMapRemove).toHaveBeenCalledTimes(1);
    expect(mockMapConstructorOptions).toHaveLength(2);
  });
});
