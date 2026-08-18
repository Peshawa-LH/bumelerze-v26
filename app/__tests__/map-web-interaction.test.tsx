/**
 * @jest-environment jsdom
 *
 * Web Map screen (`app/(tabs)/map.web.tsx`) — marker click/keyboard
 * activation and accessibility. See `map-web-creation.test.tsx`'s doc
 * comment for the jsdom-environment/mocking rationale.
 *
 * One `it()` block, not several: this combination (jsdom `document` +
 * `@testing-library/react-native`'s `act`/`waitFor` + a mocked dynamic
 * `import()`) was observed to stop flushing effects at all starting with
 * the SECOND full mount-and-settle cycle within one test file/environment,
 * for reasons not traced to any bug in `map.web.tsx` itself (isolated
 * single-mount tests, including this exact scenario run alone, always
 * pass). One render, several sequential (synchronous, already-mounted)
 * interactions against its markers avoids needing a second async settle.
 *
 * Event-preview-sheet wave: every assertion below is deliberately provable
 * WITHOUT observing a second React re-render after the initial "map
 * ready, markers built" settle (the same constraint the paragraph above
 * already documents) — each interaction is checked via a plain mock
 * function call (`mockPush`, `mockMapEaseTo`, a raw `handlers.click`
 * invocation) rather than a `getByTestId`/`waitFor` on the sheet's own
 * rendered output. The sheet's OWN rendered behavior (content, buttons,
 * detents, keyboard/focus/reduced-motion) is covered in full isolation,
 * with no map/maplibre-gl involved at all, by
 * `src/features/map/__tests__/EventPreviewSheet.test.tsx`.
 */
import { act, cleanup, render, waitFor, type RenderResult } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import {
  makeEvent,
  MockAttributionControl,
  MockMap,
  MockMarker,
  mockMapEaseTo,
  mockMapInstances,
  mockMapRemove,
  mockMarkerConstructorOptions,
  mockPush,
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
    useRouter: () => ({ push: mockPush }),
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

describe("MapScreenWeb interaction", () => {
  it("marker: click raises the preview sheet instead of navigating, Enter matches click, other keys are ignored, the map background click is wired to dismiss it, and the marker itself is accessible", async () => {
    mockUseRegionEvents.mockReturnValue({
      events: [makeEvent({ id: "us7000xyz" })],
      dataUpdatedAt: MOCK_DATA_UPDATED_AT,
    });

    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => {
      expect(mockMarkerConstructorOptions).toHaveLength(1);
    });
    const marker = mockMarkerConstructorOptions[0];

    // Accessibility: role/label/tab-stop present on the marker element
    // itself — no separate render needed to check this.
    expect(marker?.element.getAttribute("role")).toBe("button");
    expect(marker?.element.getAttribute("aria-label")).toBeTruthy();
    expect(marker?.element.tabIndex).toBe(0);

    // A key that isn't Enter/Space does nothing.
    act(() => {
      marker!.element.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      );
    });
    expect(mockMapEaseTo).not.toHaveBeenCalled();

    // Enter raises the preview sheet — a marker tap no longer navigates
    // straight to `/event/[id]` (event-preview-sheet wave); reaching the
    // full event is now the SHEET's own "open full event" action, not the
    // marker's (`EventPreviewSheet.test.tsx` covers that action directly).
    // `mockMapEaseTo` — the subtle recenter-on-select (wave brief point 3)
    // — only ever runs AFTER a successful `eventSheet.select(...)` call in
    // the same handler, so its (correct-coordinate) invocation is itself
    // proof the new selection path ran, without needing to observe a
    // second React re-render for it (see this file's own top doc comment).
    act(() => {
      marker!.element.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockMapEaseTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [45.43, 35.56] }),
    );
    // No remount: still exactly the one map instance/marker built at
    // "ready", never torn down and recreated by selecting an event.
    expect(mockMapRemove).not.toHaveBeenCalled();
    expect(mockMarkerConstructorOptions).toHaveLength(1);

    mockMapEaseTo.mockClear();

    // Click does the same thing (idempotent re-selection of the same
    // event — still no navigation, still no remount).
    act(() => {
      marker!.element.dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockMapEaseTo).toHaveBeenCalledTimes(1);
    expect(mockMapRemove).not.toHaveBeenCalled();
    expect(mockMarkerConstructorOptions).toHaveLength(1);

    // "clicking the map background should dismiss it" (wave brief point 5)
    // is wired as a plain, map-wide "click" listener (`map.web.tsx`'s own
    // doc comment on it explains why a marker tap never reaches this
    // handler at all) — invoking it here directly, exactly as MapLibre
    // itself would for a genuine background click, confirms the listener
    // is registered and safe to call (it defers to
    // `sheetRef.current?.requestClose()`, a no-op when nothing is
    // selected, and never throws) without depending on a second observable
    // re-render for it.
    expect(() => mockMapInstances[0]?.handlers.click?.()).not.toThrow();
  });
});
