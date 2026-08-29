/**
 * @jest-environment jsdom
 *
 * `MapCoordinatePicker`'s web implementation (`components/
 * MapCoordinatePicker.web.tsx`) — `maplibre-gl` is mocked at the module
 * boundary (same "no jsdom WebGL" reasoning `map-web-creation.test.tsx`
 * documents), and the jsdom environment override is needed because the
 * component renders a raw `<div>` map container.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";

class MockMarker {
  private lngLat: { lat: number; lng: number };
  private dragendHandler: (() => void) | null = null;
  options: Record<string, unknown>;

  constructor(options: Record<string, unknown>) {
    this.options = options;
    this.lngLat = { lat: 0, lng: 0 };
  }

  setLngLat([lng, lat]: [number, number]) {
    this.lngLat = { lat, lng };
    return this;
  }

  getLngLat() {
    return this.lngLat;
  }

  addTo() {
    mockMarkerAddTo();
    return this;
  }

  on(event: string, handler: () => void) {
    if (event === "dragend") {
      this.dragendHandler = handler;
    }
  }

  /** Test helper (not part of the real Marker API): simulates the pin
   * being dragged to a new point and the resulting "dragend" firing. */
  simulateDragTo(lat: number, lng: number) {
    this.lngLat = { lat, lng };
    this.dragendHandler?.();
  }

  remove() {
    mockMarkerRemove();
  }
}

class MockMap {
  handlers: Record<string, (event: { lngLat: { lat: number; lng: number } }) => void> = {};
  options: Record<string, unknown>;

  constructor(options: Record<string, unknown>) {
    this.options = options;
    mockMapInstances.push(this);
  }

  addControl(control: unknown) {
    mockMapAddControl(control);
  }

  on(event: string, handler: (event: { lngLat: { lat: number; lng: number } }) => void) {
    this.handlers[event] = handler;
  }

  resize() {
    mockMapResize();
  }

  remove() {
    mockMapRemove();
  }
}

class MockAttributionControl {
  constructor(public options: Record<string, unknown>) {}
}
class MockNavigationControl {
  constructor(public options: Record<string, unknown>) {}
}

const mockMapAddControl = jest.fn();
const mockMapRemove = jest.fn();
const mockMapResize = jest.fn();
const mockMarkerAddTo = jest.fn();
const mockMarkerRemove = jest.fn();
const mockSetWorkerUrl = jest.fn();
const mockGetRTLTextPluginStatus = jest.fn(() => "unavailable");
const mockSetRTLTextPlugin = jest.fn(() => Promise.resolve());
let mockMapInstances: MockMap[] = [];

// `{ virtual: true }`: maplibre-gl ships ESM-only, which Jest's default CJS
// resolution can't load — irrelevant here since the real package is never
// exercised. Same pattern `map-web-creation.test.tsx` uses.
/** jsdom has no ResizeObserver. The component needs one to notice that its
 * container grew after the modal finished sliding in, so the mock records
 * the callback and lets a test fire it. */
let resizeCallbacks: ResizeObserverCallback[] = [];
const mockObserve = jest.fn();
const mockDisconnect = jest.fn();
class MockResizeObserver {
  constructor(cb: ResizeObserverCallback) {
    resizeCallbacks.push(cb);
  }
  observe = mockObserve;
  unobserve = jest.fn();
  disconnect = mockDisconnect;
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = MockResizeObserver;

jest.mock(
  "maplibre-gl",
  () => ({
    Map: MockMap,
    Marker: MockMarker,
    AttributionControl: MockAttributionControl,
    NavigationControl: MockNavigationControl,
    setWorkerUrl: mockSetWorkerUrl,
    setRTLTextPlugin: mockSetRTLTextPlugin,
    getRTLTextPluginStatus: mockGetRTLTextPluginStatus,
  }),
  { virtual: true },
);

// `@/features/events`'s barrel also re-exports `EventListScreen`, which
// pulls in real `expo-router` — whose global-state module reads
// `URLSearchParams` at import time, unavailable in this file's jsdom
// environment. Same transitive-import problem `map-web-creation.test.tsx`
// hits (it imports `REGION_BBOX` from the same barrel) and the same fix:
// a minimal mock, since nothing under test here actually navigates.
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

// Explicit `.web` suffix — this repo's jest-expo preset resolves the plain
// (native) platform by default, so a suffix-less import would silently
// resolve `MapCoordinatePicker.tsx` (the native no-op), not this file. See
// that sibling file's own doc comment.
// eslint-disable-next-line import/first -- see comment above
import { MapCoordinatePicker } from "../components/MapCoordinatePicker.web";

const testSafeAreaMetrics = {
  frame: { x: 0, y: 0, width: 375, height: 812 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

async function renderPicker(props: {
  initialLat?: number | null;
  initialLon?: number | null;
  onSelect?: jest.Mock;
}) {
  const onSelect = props.onSelect ?? jest.fn();
  const result = await render(
    <SafeAreaProvider initialMetrics={testSafeAreaMetrics}>
      <MapCoordinatePicker
        initialLat={props.initialLat ?? null}
        initialLon={props.initialLon ?? null}
        onSelect={onSelect}
      />
    </SafeAreaProvider>,
  );
  return { onSelect, ...result };
}

describe("MapCoordinatePicker (web)", () => {
  const originalLanguage = i18n.language;

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    mockMapAddControl.mockClear();
    mockMapRemove.mockClear();
    mockMarkerAddTo.mockClear();
    mockMarkerRemove.mockClear();
    mockSetWorkerUrl.mockClear();
    mockGetRTLTextPluginStatus.mockClear();
    mockGetRTLTextPluginStatus.mockReturnValue("unavailable");
    mockSetRTLTextPlugin.mockClear();
    mockMapInstances = [];
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage(originalLanguage);
  });

  it("shows a 'pick on the map' trigger and no modal content before it's pressed", async () => {
    await renderPicker({});

    expect(screen.getByText("Pick on the map")).toBeTruthy();
    expect(screen.queryByText("Use this location")).toBeNull();
  });

  it("opens the map, places a pin on a map click, and confirms it back to the caller", async () => {
    const { onSelect } = await renderPicker({});

    await fireEvent.press(screen.getByText("Pick on the map"));
    expect(screen.getByText("No location selected yet.")).toBeTruthy();

    // Real MapLibre construction happens inside a dynamic `import()` — let
    // it settle before reaching into the mock map instance.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const map = mockMapInstances.at(-1);
    expect(map).toBeTruthy();
    await act(async () => {
      map?.handlers.click?.({ lngLat: { lat: 35.5, lng: 45.5 } });
    });

    expect(screen.getByText("Selected: 35.5000, 45.5000")).toBeTruthy();

    await fireEvent.press(screen.getByText("Use this location"));
    expect(onSelect).toHaveBeenCalledWith(35.5, 45.5);
    // The modal closes on confirm.
    expect(screen.queryByText("Use this location")).toBeNull();
  });

  it("starts with the current form coordinate already placed and selected", async () => {
    await renderPicker({ initialLat: 36.19, initialLon: 44.01 });

    await fireEvent.press(screen.getByText("Pick on the map"));

    expect(screen.getByText("Selected: 36.1900, 44.0100")).toBeTruthy();
  });

  it("closing without confirming never calls onSelect", async () => {
    const { onSelect } = await renderPicker({});

    await fireEvent.press(screen.getByText("Pick on the map"));
    await fireEvent.press(screen.getByText("Close"));

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByText("No location selected yet.")).toBeNull();
  });

  /**
   * Regression: MapLibre measures its container once, at construction, and
   * that happens here while the Modal is still sliding in. Without a
   * ResizeObserver the map latched onto a collapsed container and never
   * re-measured -- on a 375x812 phone the canvas stayed 100 px tall inside
   * a 600 px map area, 12% of the screen. The picker was present and the
   * pin worked; the map was simply far too small to aim with, which is
   * exactly the kind of defect a render-only test misses.
   */
  it("re-measures the map once its container settles after the modal opens", async () => {
    mockMapResize.mockClear();
    resizeCallbacks = [];
    await renderPicker({});
    await act(async () => {
      fireEvent.press(screen.getByText("Pick on the map"));
    });

    expect(mockObserve).toHaveBeenCalled();
    expect(resizeCallbacks.length).toBeGreaterThan(0);

    // The container finishes animating and reports its real size.
    await act(async () => {
      resizeCallbacks.forEach((cb) =>
        cb([] as unknown as ResizeObserverEntry[], {} as ResizeObserver),
      );
    });
    expect(mockMapResize).toHaveBeenCalled();
  });

  it("stops observing when the picker closes", async () => {
    mockDisconnect.mockClear();
    await renderPicker({});
    await act(async () => {
      fireEvent.press(screen.getByText("Pick on the map"));
    });
    await act(async () => {
      fireEvent.press(screen.getByText("Close"));
    });
    expect(mockDisconnect).toHaveBeenCalled();
  });
});
