/**
 * @jest-environment jsdom
 *
 * Web Map screen (`app/(tabs)/map.web.tsx`) — magnitude/date filters
 * (update-plan-2026-08.md §4.4). See `map-web-creation.test.tsx`'s doc
 * comment for the jsdom-environment/mocking rationale.
 *
 * The panel's two range pairs are raw DOM `<input type="range">` elements
 * (`MapFilterPanel`'s own doc comment) — located via `getByLabelText`
 * (their `aria-label`) and driven via RNTL's generic `fireEvent(element,
 * "change", { target: { value } })`, which invokes the element's `onChange`
 * prop directly with a `{ target: { value } }` shape, exactly like a real
 * DOM change event's `event.target.value` — verified empirically against
 * this project's `@testing-library/react-native` + jsdom setup before
 * relying on it here.
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
  MockMarker,
  mockMarkerConstructorOptions,
  mockMarkerRemove,
  mockGetRTLTextPluginStatus,
  MOCK_DATA_UPDATED_AT,
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

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
// Deterministic "now" for this file — the app itself sources its date-filter
// upper bound from React Query's own `dataUpdatedAt`, not a live
// `Date.now()` read (`map.web.tsx`'s own doc comment explains why), so
// fixture events are built relative to that SAME fixed instant rather than
// the real wall clock.
const NOW = MOCK_DATA_UPDATED_AT;

beforeEach(() => {
  resetMapWebMocks();
  mockUseRegionEvents.mockReturnValue({
    events: [
      makeEvent({ id: "low", magnitude: { value: 3.0, type: "mb" }, originTime: NOW - 10 * ONE_DAY_MS }),
      makeEvent({ id: "mid", magnitude: { value: 4.5, type: "mb" }, originTime: NOW - 5 * ONE_DAY_MS }),
      makeEvent({ id: "high", magnitude: { value: 6.5, type: "mww" }, originTime: NOW }),
    ],
    dataUpdatedAt: MOCK_DATA_UPDATED_AT,
  });
});

afterEach(() => {
  cleanup();
});

async function expandFilters(): Promise<void> {
  const toggle = screen.getByRole("button", { name: i18n.t("map.filters.expandA11yHint") });
  await act(async () => {
    fireEvent.press(toggle);
  });
}

describe("MapScreenWeb magnitude/date filters", () => {
  it("shows a compact 'all events' summary when collapsed and nothing has been narrowed yet", async () => {
    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => expect(mockMarkerConstructorOptions).toHaveLength(3));

    expect(screen.getByText("all events", { exact: false })).toBeTruthy();
  });

  it("expands to reveal magnitude and date range controls", async () => {
    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => expect(mockMarkerConstructorOptions).toHaveLength(3));

    await expandFilters();

    expect(
      screen.getByRole("button", { name: i18n.t("map.filters.collapseA11yHint") }),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(i18n.t("map.filters.magnitudeMinA11yLabel")),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(i18n.t("map.filters.magnitudeMaxA11yLabel")),
    ).toBeTruthy();
    expect(screen.getByLabelText(i18n.t("map.filters.dateMinA11yLabel"))).toBeTruthy();
    expect(screen.getByLabelText(i18n.t("map.filters.dateMaxA11yLabel"))).toBeTruthy();
  });

  it("narrowing the minimum magnitude hides lower-magnitude markers (filters the already-fetched set, no new fetch)", async () => {
    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => expect(mockMarkerConstructorOptions).toHaveLength(3));
    await expandFilters();

    const magMin = screen.getByLabelText(i18n.t("map.filters.magnitudeMinA11yLabel"));
    await act(async () => {
      fireEvent(magMin, "change", { target: { value: "4" } });
    });

    // "low" (M3.0) drops out; "mid" (M4.5) and "high" (M6.5) remain — 3
    // original markers torn down, 2 new ones built (cumulative log: 3+2=5).
    await waitFor(() => expect(mockMarkerConstructorOptions).toHaveLength(5));
    expect(mockMarkerRemove).toHaveBeenCalledTimes(3);
    expect(mockUseRegionEvents).toHaveBeenCalled(); // no new fetch call was ever needed for this
  });

  it("clamps the max handle so it can never go below the min handle (no inverted range)", async () => {
    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => expect(mockMarkerConstructorOptions).toHaveLength(3));
    await expandFilters();

    // Re-queried fresh before EACH `fireEvent` (not queried once and
    // reused) — a queried element's `onChange` closes over the props at
    // query time, so reusing a stale reference across a state update would
    // invoke a stale closure and silently miss the second change.
    await act(async () => {
      fireEvent(screen.getByLabelText(i18n.t("map.filters.magnitudeMinA11yLabel")), "change", {
        target: { value: "5" },
      });
    });
    await act(async () => {
      // Dragging max below the current min clamps it AT the min (5), not
      // past it — the resulting [5, 5] range matches none of the three
      // fixture events exactly, so every marker disappears.
      fireEvent(screen.getByLabelText(i18n.t("map.filters.magnitudeMaxA11yLabel")), "change", {
        target: { value: "4" },
      });
    });

    // Cumulative constructor log (never shrinks, only grows — see the
    // module doc comment on `mockMarkerConstructorOptions`): initial 3,
    // then narrowing to [5, 6.5] rebuilds down to just "high" (+1 = 4);
    // clamping max to [5, 5] then matches ZERO events, so this final
    // rebuild adds none — the log stays at 4, but everything currently on
    // the map has been removed (4 cumulative removals: the initial 3, then
    // the single "high" marker from the first narrow).
    await waitFor(() => expect(mockMarkerConstructorOptions).toHaveLength(4));
    expect(mockMarkerRemove).toHaveBeenCalledTimes(4);
  });

  it("resetting restores every marker and the collapsed summary back to 'all events'", async () => {
    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => expect(mockMarkerConstructorOptions).toHaveLength(3));
    await expandFilters();

    const magMin = screen.getByLabelText(i18n.t("map.filters.magnitudeMinA11yLabel"));
    await act(async () => {
      fireEvent(magMin, "change", { target: { value: "4" } });
    });
    await waitFor(() => expect(mockMarkerConstructorOptions).toHaveLength(5));

    const resetButton = screen.getByRole("button", { name: i18n.t("map.filters.reset") });
    await act(async () => {
      fireEvent.press(resetButton);
    });

    // All 3 events reappear (cumulative log: 3 + 2 + 3 = 8).
    await waitFor(() => expect(mockMarkerConstructorOptions).toHaveLength(8));
  });

  it("narrowing the date range hides events outside it", async () => {
    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => expect(mockMarkerConstructorOptions).toHaveLength(3));
    await expandFilters();

    const dateMin = screen.getByLabelText(i18n.t("map.filters.dateMinA11yLabel"));
    await act(async () => {
      // Move the start handle to 7 days ago — drops "low" (10 days ago),
      // keeps "mid" (5 days ago) and "high" (today).
      fireEvent(dateMin, "change", { target: { value: String(NOW - 7 * ONE_DAY_MS) } });
    });

    await waitFor(() => expect(mockMarkerConstructorOptions).toHaveLength(5));
  });
});
