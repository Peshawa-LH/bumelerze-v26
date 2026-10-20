import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import {
  installStyleServer,
  lastMap,
  pressEvent,
  pretendNativeMapLibre,
  recorded,
  resetRecorded,
} from "@/features/map/__fixtures__/native-maplibre-mock";
import { clearStyleSessionCache } from "@/features/map/native-style";
import i18n from "@/i18n";
import { MapCoordinatePicker } from "../components/MapCoordinatePicker";

jest.mock(
  "@maplibre/maplibre-react-native",
  () => jest.requireActual("@/features/map/__fixtures__/native-maplibre-mock").mockModule,
);

/**
 * "Pick on the map" on MapLibre Native (`MapCoordinatePicker.tsx`), the
 * twin of the web's picker (`MapCoordinatePicker.web.test.tsx`).
 */
const metrics = {
  frame: { x: 0, y: 0, width: 375, height: 812 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

async function renderPicker(initialLat: number | null, initialLon: number | null) {
  const onSelect = jest.fn();
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <MapCoordinatePicker
        initialLat={initialLat}
        initialLon={initialLon}
        onSelect={onSelect}
      />
    </SafeAreaProvider>,
  );
  return onSelect;
}

describe("MapCoordinatePicker (iOS/Android)", () => {
  let restoreFetch: () => void;

  beforeEach(async () => {
    resetRecorded();
    clearStyleSessionCache();
    await AsyncStorage.clear();
    restoreFetch = installStyleServer();
    await i18n.changeLanguage("en");
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    restoreFetch();
  });

  it("is absent without MapLibre's native code (Expo Go), as before", async () => {
    await renderPicker(null, null);
    expect(screen.queryByText("Pick on the map")).toBeNull();
  });

  it("opens a full-screen map on the region, picks a tapped point and hands it back", async () => {
    pretendNativeMapLibre();
    const onSelect = await renderPicker(null, null);
    await act(async () => {
      fireEvent.press(screen.getByText("Pick on the map"));
    });
    await waitFor(() => expect(recorded.maps.length).toBeGreaterThan(0));
    expect(screen.getByText("Pick a location")).toBeTruthy();
    expect(screen.getByText("No location selected yet.")).toBeTruthy();
    expect(recorded.cameras[0]?.initialViewState).toMatchObject({
      bounds: [41, 33, 48.5, 38.5],
    });
    expect(screen.getByText("Use this location")).toBeDisabled();

    await act(async () => {
      (lastMap().onPress as (event: unknown) => void)(pressEvent([45.4321, 35.5678]));
    });
    expect(screen.getByText("Selected: 35.5678, 45.4321")).toBeTruthy();
    expect(recorded.annotations[recorded.annotations.length - 1]).toMatchObject({
      lngLat: [45.4321, 35.5678],
      draggable: true,
    });

    await act(async () => {
      fireEvent.press(screen.getByText("Use this location"));
    });
    expect(onSelect).toHaveBeenCalledWith(35.5678, 45.4321);
  });

  it("starts on an entered coordinate with the pin already there, at the web's zoom", async () => {
    pretendNativeMapLibre();
    await renderPicker(36.19, 44.01);
    await act(async () => {
      fireEvent.press(screen.getByText("Pick on the map"));
    });
    await waitFor(() => expect(recorded.maps.length).toBeGreaterThan(0));
    expect(recorded.cameras[0]?.initialViewState).toEqual({
      center: [44.01, 36.19],
      zoom: 10,
    });
    expect(recorded.annotations[0]?.lngLat).toEqual([44.01, 36.19]);
  });
});
