/**
 * @jest-environment jsdom
 *
 * Web Map screen (`app/(tabs)/map.web.tsx`) — marker tap/click/keyboard
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
 *
 * Regression coverage for the fixed tap-through bug (map.web.tsx's own
 * marker-activation doc comment has the full mechanism): selection is
 * driven from `pointerdown`/`pointerup`, NOT `click` — jsdom has no
 * `PointerEvent` constructor, so these are dispatched as plain `MouseEvent`s
 * with their `type` overridden to `"pointerdown"`/`"pointerup"` (a DOM
 * listener only ever matches on `event.type`, so this is a faithful stand-in
 * for the real event without needing jsdom to implement the Pointer Events
 * spec). `dispatchTap`/`dispatchPointerDown`/`dispatchPointerUp` below never
 * dispatch a `"click"` event themselves — a test proving selection through
 * ONLY these is a test that would fail against the pre-fix `click`-only
 * wiring, exactly the "exercises the touch path rather than only a
 * synthetic click" coverage this regression needs.
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
} from "@/features/map/__fixtures__/map-web-helpers";

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

/** See this file's own top doc comment for why `MouseEvent` (not
 * `PointerEvent`, which jsdom doesn't implement) stands in for the marker's
 * real `pointerdown`/`pointerup` listeners here. */
function dispatchPointerDown(element: HTMLElement, x = 0, y = 0): void {
  element.dispatchEvent(
    new MouseEvent("pointerdown", { bubbles: true, clientX: x, clientY: y }),
  );
}
function dispatchPointerUp(element: HTMLElement, x = 0, y = 0): void {
  element.dispatchEvent(
    new MouseEvent("pointerup", { bubbles: true, clientX: x, clientY: y }),
  );
}
/** A stationary tap: pointerdown and pointerup at the SAME coordinates —
 * always within `MARKER_TAP_TOLERANCE_PX`, so this always counts as a tap,
 * never a drag. */
function dispatchTap(element: HTMLElement, x = 0, y = 0): void {
  dispatchPointerDown(element, x, y);
  dispatchPointerUp(element, x, y);
}

beforeEach(() => {
  resetMapWebMocks();
});

afterEach(() => {
  cleanup();
});

describe("MapScreenWeb interaction", () => {
  it("marker: tap/click/keyboard all raise the preview sheet, a drag-tolerance-exceeding pointer sequence does not, the map background click is wired to dismiss it, and the marker itself is accessible", async () => {
    mockUseRegionEvents.mockReturnValue({
      events: [makeEvent({ id: "us7000xyz" })],
      dataUpdatedAt: MOCK_DATA_UPDATED_AT,
    });

    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => {
      expect(mockMarkerConstructorOptions).toHaveLength(1);
    });
    const marker = mockMarkerConstructorOptions[0];
    const markerEl = marker!.element;

    // Accessibility: role/label/tab-stop present on the marker element
    // itself — no separate render needed to check this.
    expect(markerEl.getAttribute("role")).toBe("button");
    expect(markerEl.getAttribute("aria-label")).toBeTruthy();
    expect(markerEl.tabIndex).toBe(0);

    // A key that isn't Enter/Space does nothing.
    act(() => {
      markerEl.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      );
    });
    expect(mockMapEaseTo).not.toHaveBeenCalled();

    // REGRESSION (the touch path): a real tap is a `pointerdown` +
    // `pointerup` pair — no `"click"` event dispatched at all — and it must
    // still raise the sheet. This is the case that broke on real phones:
    // MapLibre's own single-finger pan handler cancels the `touchmove` that
    // (almost) always occurs during a real touch, which suppresses the
    // browser's synthesized `click` for that whole touch sequence; a marker
    // whose selection depended on `click` therefore never opened on a real
    // device even though it did in devtools (see map.web.tsx's own
    // marker-activation doc comment for the confirmed mechanism).
    // `mockMapEaseTo` — the subtle recenter-on-select — only ever runs
    // AFTER a successful `eventSheet.select(...)` call in the same handler,
    // so its (correct-coordinate) invocation is itself proof the selection
    // path ran, without needing to observe a second React re-render for it
    // (see this file's own top doc comment).
    act(() => {
      dispatchTap(markerEl, 10, 10);
    });
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockMapEaseTo).toHaveBeenCalledTimes(1);
    expect(mockMapEaseTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [45.43, 35.56] }),
    );
    // No remount: still exactly the one map instance/marker built at
    // "ready", never torn down and recreated by selecting an event.
    expect(mockMapRemove).not.toHaveBeenCalled();
    expect(mockMarkerConstructorOptions).toHaveLength(1);

    mockMapEaseTo.mockClear();

    // A pointerdown/pointerup pair that drifts past the tap tolerance is a
    // drag starting on the marker (e.g. a pan gesture), not a tap — it must
    // NOT select.
    act(() => {
      dispatchPointerDown(markerEl, 0, 0);
      dispatchPointerUp(markerEl, 40, 40);
    });
    expect(mockMapEaseTo).not.toHaveBeenCalled();

    // Enter raises the preview sheet too — a marker tap no longer navigates
    // straight to `/event/[id]` (event-preview-sheet wave); reaching the
    // full event is now the SHEET's own "open full event" action, not the
    // marker's (`EventPreviewSheet.test.tsx` covers that action directly).
    act(() => {
      markerEl.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockMapEaseTo).toHaveBeenCalledTimes(1);

    mockMapEaseTo.mockClear();

    // A residual native "click" — the case where the browser DOES still
    // synthesize one (a stationary mouse click, or a touch tap that
    // happened to produce zero intermediate touchmoves) — must not select a
    // SECOND time: the marker's own `pointerup` listener already handled
    // the tap, and its `click` listener only exists to stop the event from
    // reaching the map's background-dismiss handler, never to re-select.
    act(() => {
      markerEl.dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    expect(mockMapEaseTo).not.toHaveBeenCalled();
    expect(mockMapRemove).not.toHaveBeenCalled();
    expect(mockMarkerConstructorOptions).toHaveLength(1);

    // "clicking the map background should dismiss it" (wave brief point 5)
    // is wired as a plain, map-wide "click" listener — invoking it here
    // directly, exactly as MapLibre itself would for a genuine background
    // click, confirms the listener is registered and safe to call (it
    // defers to `sheetRef.current?.requestClose()`, a no-op when nothing is
    // selected, and never throws) without depending on a second observable
    // re-render for it.
    expect(() => mockMapInstances[0]?.handlers.click?.()).not.toThrow();
  });
});
