/**
 * @jest-environment jsdom
 *
 * `PinMap.web.tsx`: tap to place, drag to adjust. `maplibre-gl` is mocked at
 * the module boundary (same approach as the other embedded map tests).
 */
import { act, render } from "@testing-library/react-native";

const mockMapOptions: Record<string, unknown>[] = [];
const mockMapHandlers: Record<string, (event?: unknown) => void> = {};
const mockMarkerOptions: Record<string, unknown>[] = [];
const mockMarkerHandlers: Record<string, () => void> = {};
const mockMarkerSetLngLat = jest.fn();
let mockMarkerPosition = { lng: 0, lat: 0 };
const mockMapRemove = jest.fn();

class MockMap {
  constructor(options: Record<string, unknown>) {
    mockMapOptions.push(options);
  }
  addControl() {}
  on(event: string, handler: (event?: unknown) => void) {
    mockMapHandlers[event] = handler;
  }
  getContainer() {
    return document.createElement("div");
  }
  remove() {
    mockMapRemove();
  }
}

class MockMarker {
  constructor(options: Record<string, unknown>) {
    mockMarkerOptions.push(options);
  }
  setLngLat(lngLat: unknown) {
    mockMarkerSetLngLat(lngLat);
    return this;
  }
  addTo() {
    return this;
  }
  on(event: string, handler: () => void) {
    mockMarkerHandlers[event] = handler;
  }
  getLngLat() {
    return mockMarkerPosition;
  }
}

jest.mock(
  "maplibre-gl",
  () => ({
    Map: MockMap,
    Marker: MockMarker,
    NavigationControl: class {},
    AttributionControl: class {},
    setWorkerUrl: () => {},
    getRTLTextPluginStatus: () => "unavailable",
    setRTLTextPlugin: () => Promise.resolve(),
  }),
  { virtual: true },
);
jest.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}), { virtual: true });

// eslint-disable-next-line import/first -- after the mocks above
import { PIN_MAP_AVAILABLE, PinMap } from "../components/PinMap.web";

const START = { lat: 36.19, lon: 44.01, zoom: 13, source: "town" as const };

async function renderPinMap(onPoint = jest.fn()) {
  await render(<PinMap start={START} onPoint={onPoint} accessibilityLabel="Pin map" />);
  // Let the lazy `import("maplibre-gl")` resolve and the map get built.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return onPoint;
}

describe("PinMap.web", () => {
  beforeEach(() => {
    mockMapOptions.length = 0;
    mockMarkerOptions.length = 0;
    for (const key of Object.keys(mockMarkerHandlers)) delete mockMarkerHandlers[key];
    for (const key of Object.keys(mockMapHandlers)) delete mockMapHandlers[key];
    mockMarkerSetLngLat.mockClear();
  });

  it("is available on web", () => {
    expect(PIN_MAP_AVAILABLE).toBe(true);
  });

  it("starts centred on the start point with a draggable pin there", async () => {
    await renderPinMap();
    expect(mockMapOptions[0]).toMatchObject({ center: [44.01, 36.19], zoom: 13 });
    expect(mockMarkerOptions[0]).toMatchObject({ draggable: true });
    expect(mockMarkerSetLngLat).toHaveBeenCalledWith([44.01, 36.19]);
  });

  it("tapping the map moves the pin and reports the point", async () => {
    const onPoint = await renderPinMap();
    await act(async () => {
      mockMapHandlers.click?.({ lngLat: { lat: 36.3, lng: 44.2 } });
    });
    expect(mockMarkerSetLngLat).toHaveBeenLastCalledWith({ lat: 36.3, lng: 44.2 });
    expect(onPoint).toHaveBeenCalledWith({ lat: 36.3, lon: 44.2 });
  });

  it("dragging the pin reports where it was dropped", async () => {
    const onPoint = await renderPinMap();
    mockMarkerPosition = { lat: 36.25, lng: 44.05 };
    await act(async () => {
      mockMarkerHandlers.dragend?.();
    });
    expect(onPoint).toHaveBeenCalledWith({ lat: 36.25, lon: 44.05 });
  });
});
