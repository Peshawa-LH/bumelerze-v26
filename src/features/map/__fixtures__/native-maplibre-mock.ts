/**
 * A recording stand-in for `@maplibre/maplibre-react-native` for the
 * native map tests: every element records its props, refs answer the
 * methods the app calls. Use inside `jest.mock`:
 *
 *   jest.mock("@maplibre/maplibre-react-native", () =>
 *     jest.requireActual("@/features/map/__fixtures__/native-maplibre-mock").mockModule,
 *   );
 *
 * plus a `TurboModuleRegistry.get` spy answering "MLRNMapViewModule" so
 * `loadNativeMapLibre()` finds "native code".
 */
import { createElement, useImperativeHandle, type ReactNode, type Ref } from "react";
import { TurboModuleRegistry, View } from "react-native";

import type { StyleDocument } from "../native-style";

export interface Recorded {
  id?: string;
  [key: string]: unknown;
}

export const recorded = {
  maps: [] as Recorded[],
  cameras: [] as Recorded[],
  sources: new Map<string, Recorded>(),
  layers: new Map<string, Recorded>(),
  annotations: [] as Recorded[],
  images: [] as Recorded[],
  zoomTo: jest.fn(),
  fitBounds: jest.fn(),
  easeTo: jest.fn(),
  showAttribution: jest.fn(async () => undefined),
};

export function resetRecorded(): void {
  recorded.maps.length = 0;
  recorded.cameras.length = 0;
  recorded.sources.clear();
  recorded.layers.clear();
  recorded.annotations.length = 0;
  recorded.images.length = 0;
  recorded.zoomTo.mockClear();
  recorded.fitBounds.mockClear();
  recorded.easeTo.mockClear();
  recorded.showAttribution.mockClear();
}

export function lastMap(): Recorded {
  const props = recorded.maps[recorded.maps.length - 1];
  if (!props) throw new Error("no native map was rendered");
  return props;
}

type WithChildren = Recorded & { children?: ReactNode; ref?: Ref<unknown> };

export const mockModule = {
  Map: function MockMap(props: WithChildren) {
    recorded.maps.push(props);
    useImperativeHandle(props.ref, () => ({
      getZoom: async () => 7,
      showAttribution: recorded.showAttribution,
      project: async ([lon, lat]: [number, number]) => [lon * 10, lat * 10],
      unproject: async ([x, y]: [number, number]) => [x / 10, y / 10],
    }));
    return createElement(
      View,
      { testID: String(props.testID ?? "native-map") },
      props.children,
    );
  },
  Camera: function MockCamera(props: WithChildren) {
    recorded.cameras.push(props);
    useImperativeHandle(props.ref, () => ({
      zoomTo: recorded.zoomTo,
      fitBounds: recorded.fitBounds,
      easeTo: recorded.easeTo,
    }));
    return null;
  },
  GeoJSONSource: function MockGeoJSONSource(props: WithChildren) {
    recorded.sources.set(String(props.id), { ...props, kind: "geojson" });
    return createElement(View, null, props.children);
  },
  ImageSource: function MockImageSource(props: WithChildren) {
    recorded.sources.set(String(props.id), { ...props, kind: "image" });
    return createElement(View, null, props.children);
  },
  Layer: function MockLayer(props: Recorded) {
    recorded.layers.set(String(props.id), props);
    return null;
  },
  Images: function MockImages(props: Recorded) {
    recorded.images.push(props);
    return null;
  },
  ViewAnnotation: function MockViewAnnotation(props: WithChildren) {
    recorded.annotations.push(props);
    return createElement(View, null, props.children);
  },
};

/** Makes `loadNativeMapLibre()` see MapLibre's native code. */
export function pretendNativeMapLibre(): void {
  const original = TurboModuleRegistry.get.bind(TurboModuleRegistry);
  jest
    .spyOn(TurboModuleRegistry, "get")
    .mockImplementation((name: string) =>
      name === "MLRNMapViewModule" ? ({} as never) : original(name),
    );
}

/** A small style document the fake style server hands out. */
export const TEST_STYLE: StyleDocument = {
  version: 8,
  sources: { planet: { type: "vector" } },
  layers: [
    { id: "water", type: "fill" },
    { id: "place-city", type: "symbol", layout: { "text-field": ["get", "name"] } },
  ],
};

/** Replaces `fetch` with a style server; returns the restore function. */
export function installStyleServer(fail: () => boolean = () => false): () => void {
  const original = global.fetch;
  global.fetch = jest.fn(async () => {
    if (fail()) throw new TypeError("Network request failed");
    return { ok: true, status: 200, json: async () => TEST_STYLE } as Response;
  }) as typeof fetch;
  return () => {
    global.fetch = original;
  };
}

/** A map press as MapLibre React Native reports it. */
export function pressEvent(lngLat: [number, number], features: unknown[] = []) {
  return {
    stopPropagation: jest.fn(),
    nativeEvent: { lngLat, point: [0, 0], features },
  };
}
