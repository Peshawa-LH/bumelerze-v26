import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react-native";

import {
  installStyleServer,
  lastMap,
  pressEvent,
  pretendNativeMapLibre,
  recorded,
  resetRecorded,
} from "@/features/map/__fixtures__/native-maplibre-mock";
import { clearStyleSessionCache } from "@/features/map/native-style";
import { useMapPreferencesStore } from "@/features/map/preferences-store";
import { lightColors } from "@/theme/semantic";

jest.mock(
  "@maplibre/maplibre-react-native",
  () => jest.requireActual("@/features/map/__fixtures__/native-maplibre-mock").mockModule,
);

/**
 * The building's "Place on map" pin on MapLibre Native (`PinMap.tsx`),
 * the twin of `PinMap.web.tsx` (`PinMap.web.test.tsx`).
 */
const START = { lat: 35.56, lon: 45.43, zoom: 13, source: "town" as const };

describe("PinMap (iOS/Android)", () => {
  let restoreFetch: () => void;

  beforeEach(async () => {
    resetRecorded();
    clearStyleSessionCache();
    await AsyncStorage.clear();
    restoreFetch = installStyleServer();
    pretendNativeMapLibre();
    useMapPreferencesStore.setState({ styleId: "outdoor", hasHydrated: true });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    restoreFetch();
  });

  async function renderPinMap() {
    const { PinMap } =
      jest.requireActual<typeof import("../components/PinMap")>("../components/PinMap");
    const onPoint = jest.fn();
    await render(<PinMap start={START} onPoint={onPoint} accessibilityLabel="Pin map" />);
    await waitFor(() => expect(recorded.maps.length).toBeGreaterThan(0));
    return onPoint;
  }

  it("opens on the start, on the saved basemap, with the pin there", async () => {
    await renderPinMap();
    expect(recorded.cameras[0]?.initialViewState).toEqual({
      center: [45.43, 35.56],
      zoom: 13,
    });
    expect(recorded.annotations[0]).toMatchObject({
      lngLat: [45.43, 35.56],
      anchor: "bottom",
      draggable: true,
    });
    expect(screen.getByLabelText("Pin map")).toBeTruthy();
  });

  it("moves the pin to a tapped point and reports it", async () => {
    const onPoint = await renderPinMap();
    await act(async () => {
      (lastMap().onPress as (event: unknown) => void)(pressEvent([45.5, 35.6]));
    });
    expect(onPoint).toHaveBeenLastCalledWith({ lat: 35.6, lon: 45.5 });
    expect(recorded.annotations[recorded.annotations.length - 1]?.lngLat).toEqual([
      45.5, 35.6,
    ]);
  });

  it("reports where a dragged pin was let go", async () => {
    const onPoint = await renderPinMap();
    await act(async () => {
      (recorded.annotations[0]?.onDragEnd as (event: unknown) => void)(
        pressEvent([45.41, 35.52]),
      );
    });
    expect(onPoint).toHaveBeenLastCalledWith({ lat: 35.52, lon: 45.41 });
  });

  it("draws the pin in the danger colour, as the web's marker", async () => {
    await renderPinMap();
    const pin = recorded.annotations[0]?.children as { props: { color: string } };
    expect(pin.props.color).toBe(lightColors.status.danger);
  });
});

describe("PinMap without MapLibre's native code (Expo Go)", () => {
  it("is not offered", () => {
    jest.isolateModules(() => {
      const { PIN_MAP_AVAILABLE } =
        jest.requireActual<typeof import("../components/PinMap")>("../components/PinMap");
      expect(PIN_MAP_AVAILABLE).toBe(false);
    });
  });
});
