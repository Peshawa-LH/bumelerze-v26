/**
 * @jest-environment jsdom
 *
 * Web Map screen (`app/(tabs)/map.web.tsx`) — the floating filter/style
 * controls' compact-collapse state machine (Problem 1: "controls crowd the
 * map at phone width"). See `map-web-creation.test.tsx`'s doc comment for
 * the jsdom-environment/mocking rationale.
 *
 * `window.innerWidth` is set BELOW `MAP_CONTROLS_COMPACT_MAX_WIDTH_PX`
 * before each render in this file (jsdom's own default, 1024, is what
 * every OTHER map test file implicitly renders at — the existing "wide"
 * always-legible header bar, untouched by this wave, per that constant's
 * own doc comment in `responsive.ts`).
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
import { DEFAULT_MAP_STYLE_CATALOG_ID, useMapPreferencesStore } from "@/features/map";
import {
  makeEvent,
  MockAttributionControl,
  MockMap,
  MockMarker,
  mockGetRTLTextPluginStatus,
  MOCK_DATA_UPDATED_AT,
  mockSetRTLTextPlugin,
  mockSetWorkerUrl,
  mockUseRegionEvents,
  mockUseWorldEvents,
  resetMapWebMocks,
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

const ORIGINAL_INNER_WIDTH = window.innerWidth;

function setWindowWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
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
  // Phone-width default for every test in this file.
  setWindowWidth(360);
});

afterEach(() => {
  cleanup();
  setWindowWidth(ORIGINAL_INNER_WIDTH);
  // The persisted style pick is a module-singleton zustand store — reset
  // it so a test that seeds a non-default value (below) never leaks into a
  // later test in this same file.
  useMapPreferencesStore.setState({ styleId: DEFAULT_MAP_STYLE_CATALOG_ID });
});

describe("MapScreenWeb compact controls (phone width)", () => {
  it("collapses filter and style to icon-only buttons, with no visible text label", async () => {
    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: i18n.t("map.filters.expandA11yHint") }),
      ).toBeTruthy();
    });

    // The wide-layout header text ("Filters" title, the "all events"
    // summary, and the style name) never renders while collapsed+compact —
    // confirms this is really an icon-only button, not just a narrower bar.
    expect(screen.queryByText(i18n.t("map.filters.title"))).toBeNull();
    expect(screen.queryByText("all events", { exact: false })).toBeNull();
    expect(screen.queryByText(i18n.t("map.style.outdoor"))).toBeNull();

    // Still a real 44dp-floor tap target with an accessible name and
    // collapsed `expanded` state, exactly like the wide layout's own
    // header toggle.
    const filterToggle = screen.getByRole("button", {
      name: i18n.t("map.filters.expandA11yHint"),
    });
    expect(filterToggle.props.accessibilityState).toMatchObject({ expanded: false });
    const styleToggle = screen.getByRole("button", {
      name: i18n.t("map.style.expandA11yHint"),
    });
    expect(styleToggle.props.accessibilityState).toMatchObject({ expanded: false });
  });

  it("opens the filter popover on tap, revealing the full slider body with the expanded state announced", async () => {
    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: i18n.t("map.filters.expandA11yHint") }),
      ).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(
        screen.getByRole("button", { name: i18n.t("map.filters.expandA11yHint") }),
      );
    });

    expect(
      screen.getByLabelText(i18n.t("map.filters.magnitudeMinA11yLabel")),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: i18n.t("map.filters.collapseA11yHint") }),
    ).toBeTruthy();
  });

  it("only one control is open at a time — opening style closes an already-open filter popover", async () => {
    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: i18n.t("map.filters.expandA11yHint") }),
      ).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(
        screen.getByRole("button", { name: i18n.t("map.filters.expandA11yHint") }),
      );
    });
    expect(
      screen.getByLabelText(i18n.t("map.filters.magnitudeMinA11yLabel")),
    ).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: i18n.t("map.style.expandA11yHint") }));
    });

    // Filter popover's body is gone; the filter control is back to its
    // collapsed icon (re-queryable by its base collapsed name), and the
    // style popover's chip row is now showing instead.
    expect(
      screen.queryByLabelText(i18n.t("map.filters.magnitudeMinA11yLabel")),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: i18n.t("map.filters.expandA11yHint") }),
    ).toBeTruthy();
    expect(
      screen.getByRole("radio", { name: i18n.t(`map.style.${DEFAULT_MAP_STYLE_CATALOG_ID}`) }),
    ).toBeTruthy();
  });

  it("tapping the backdrop closes whichever popover is open", async () => {
    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: i18n.t("map.filters.expandA11yHint") }),
      ).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(
        screen.getByRole("button", { name: i18n.t("map.filters.expandA11yHint") }),
      );
    });
    expect(
      screen.getByLabelText(i18n.t("map.filters.magnitudeMinA11yLabel")),
    ).toBeTruthy();

    // `includeHiddenElements: true` — the backdrop is deliberately
    // `accessibilityElementsHidden`/`importantForAccessibility="no-hide-
    // descendants"` (see `map.web.tsx`'s own comment on it), which RNTL's
    // default queries exclude by design (matches this codebase's existing
    // decorative-but-still-testable pattern, e.g. `LevelTile.test.tsx`).
    await act(async () => {
      fireEvent.press(
        screen.getByTestId("map-controls-backdrop", { includeHiddenElements: true }),
      );
    });

    expect(
      screen.queryByLabelText(i18n.t("map.filters.magnitudeMinA11yLabel")),
    ).toBeNull();
    expect(
      screen.queryByTestId("map-controls-backdrop", { includeHiddenElements: true }),
    ).toBeNull();
  });

  it("pressing Escape closes an open popover for keyboard users", async () => {
    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: i18n.t("map.filters.expandA11yHint") }),
      ).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(
        screen.getByRole("button", { name: i18n.t("map.filters.expandA11yHint") }),
      );
    });
    expect(
      screen.getByLabelText(i18n.t("map.filters.magnitudeMinA11yLabel")),
    ).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(
      screen.queryByLabelText(i18n.t("map.filters.magnitudeMinA11yLabel")),
    ).toBeNull();
  });

  it("shows an active-state indicator (a different accessible name) on the collapsed filter icon once a filter is narrowed", async () => {
    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: i18n.t("map.filters.expandA11yHint") }),
      ).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(
        screen.getByRole("button", { name: i18n.t("map.filters.expandA11yHint") }),
      );
    });
    await act(async () => {
      fireEvent(
        screen.getByLabelText(i18n.t("map.filters.magnitudeMinA11yLabel")),
        "change",
        { target: { value: "5" } },
      );
    });
    // Narrowing a filter doesn't auto-collapse the panel (same as the wide
    // layout) — collapse it explicitly via its own collapse toggle to
    // reach the collapsed-icon state this test actually cares about.
    await act(async () => {
      fireEvent.press(
        screen.getByRole("button", { name: i18n.t("map.filters.collapseA11yHint") }),
      );
    });

    // The collapsed icon's accessible name no longer matches the bare
    // default hint — it now carries the live summary too (this
    // component's `collapsedIconA11yLabel` composition), which is what a
    // screen-reader user hears as the "active" signal a sighted user gets
    // from the badge dot.
    expect(
      screen.queryByRole("button", { name: i18n.t("map.filters.expandA11yHint") }),
    ).toBeNull();
    expect(
      screen.getByRole("button", {
        name: new RegExp(`^${i18n.t("map.filters.expandA11yHint")}\\. `),
      }),
    ).toBeTruthy();
  });

  it("shows an active-state indicator on the collapsed style icon when a non-default style is already selected", async () => {
    // Seeds the persisted style pick directly (bypassing the live
    // `map.setStyle()` -> `"style.load"` async chain a real in-app pick
    // goes through — that chain is already covered end-to-end by
    // `map-web-style-picker.test.tsx`; this test only cares about the
    // collapsed icon's OWN accessible-name composition for a non-default
    // value, which doesn't need a live style swap to observe).
    useMapPreferencesStore.setState({ styleId: "topo" });

    await renderWithProviders(<MapScreenWeb />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: `${i18n.t("map.style.expandA11yHint")}. ${i18n.t("map.style.topo")}`,
        }),
      ).toBeTruthy();
    });
    expect(
      screen.queryByRole("button", { name: i18n.t("map.style.expandA11yHint") }),
    ).toBeNull();
  });
});

describe("MapScreenWeb controls at a wide (non-compact) width", () => {
  it("keeps today's always-legible header bar instead of collapsing to icons", async () => {
    setWindowWidth(1024);
    await renderWithProviders(<MapScreenWeb />);

    await waitFor(() => {
      expect(screen.getByText(i18n.t("map.style.outdoor"))).toBeTruthy();
    });
    expect(screen.queryByText("all events", { exact: false })).toBeTruthy();
  });
});
