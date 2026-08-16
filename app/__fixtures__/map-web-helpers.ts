/**
 * Shared maplibre-gl mock + fixtures for the Map (web) screen test files
 * (`map-web-*.test.tsx`).
 */
import { act } from "@testing-library/react-native";

import type { Event } from "@/features/events";

export const mockPush = jest.fn();

export const mockUseRegionEvents = jest.fn();

/** `on("load"/"error", handler)` auto-fires the registered handler on the
 * next microtask — mirroring a real map's async style-load completion.
 * Controlled by `mockNextMapShouldError` (module scope, reset by each
 * file's own `beforeEach`) so error-path tests can flip a flag instead of
 * reaching into the map instance and firing events by hand. */
let mockNextMapShouldError = false;
export function setMockNextMapShouldError(value: boolean) {
  mockNextMapShouldError = value;
}

export const mockMapAddControl = jest.fn();
export const mockMapRemove = jest.fn();
export const mockMarkerSetLngLat = jest.fn();
export const mockMarkerAddTo = jest.fn();
export const mockMarkerRemove = jest.fn();
export const mockMapConstructorOptions: Record<string, unknown>[] = [];
export const mockMarkerConstructorOptions: { element: HTMLElement }[] = [];

export class MockMap {
  options: Record<string, unknown>;
  handlers: Record<string, () => void> = {};

  constructor(options: Record<string, unknown>) {
    this.options = options;
    mockMapConstructorOptions.push(options);
  }

  on(event: string, handler: () => void) {
    this.handlers[event] = handler;
    if (event === "load" && !mockNextMapShouldError) {
      void Promise.resolve().then(() => act(() => handler()));
    }
    if (event === "error" && mockNextMapShouldError) {
      void Promise.resolve().then(() => act(() => handler()));
    }
  }

  addControl(control: unknown) {
    mockMapAddControl(control);
  }

  remove() {
    mockMapRemove();
  }
}

export class MockMarker {
  element: HTMLElement;

  constructor(options: { element: HTMLElement }) {
    this.element = options.element;
    mockMarkerConstructorOptions.push(options);
  }

  setLngLat(lngLat: [number, number]) {
    mockMarkerSetLngLat(lngLat);
    return this;
  }

  addTo(map: MockMap) {
    mockMarkerAddTo(map);
    return this;
  }

  remove() {
    mockMarkerRemove();
  }
}

export class MockAttributionControl {
  options: Record<string, unknown>;
  constructor(options: Record<string, unknown>) {
    this.options = options;
  }
}

export const testSafeAreaMetrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

export function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: "us7000abcd",
    originTime: Date.UTC(2026, 7, 15, 12, 0, 0),
    lat: 35.56,
    lon: 45.43,
    depthKm: 10,
    magnitude: { value: 4.5, type: "mb" },
    placeName: "32 km SE of Halabja, Iraq",
    provenance: {
      provider: "usgs",
      providerId: "us7000abcd",
      fetchedAt: Date.now(),
      providerUpdatedAt: Date.now(),
    },
    sig: 300,
    isRegional: true,
    url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd",
    ...overrides,
  };
}

export function resetMapWebMocks() {
  mockNextMapShouldError = false;
  mockPush.mockClear();
  mockMapAddControl.mockClear();
  mockMapRemove.mockClear();
  mockMarkerSetLngLat.mockClear();
  mockMarkerAddTo.mockClear();
  mockMarkerRemove.mockClear();
  mockMapConstructorOptions.length = 0;
  mockMarkerConstructorOptions.length = 0;
  mockUseRegionEvents.mockReturnValue({ events: [] });
}
