import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, cleanup, render, waitFor } from "@testing-library/react-native";

import {
  installStyleServer,
  pressEvent,
  pretendNativeMapLibre,
  recorded,
  resetRecorded,
} from "@/features/map/__fixtures__/native-maplibre-mock";
import { clearStyleSessionCache } from "@/features/map/native-style";
import { useMapPreferencesStore } from "@/features/map/preferences-store";
import { listLiveStations } from "../catalog";
import { StationsMap } from "../components/StationsMap";
import { stationIconDataUri } from "../station-icon";

jest.mock(
  "@maplibre/maplibre-react-native",
  () => jest.requireActual("@/features/map/__fixtures__/native-maplibre-mock").mockModule,
);

describe("StationsMap (iOS/Android)", () => {
  let restoreFetch: () => void;
  const stations = listLiveStations();

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

  it("draws every station as a triangle coloured by freshness, the selected one larger", async () => {
    const onSelect = jest.fn();
    const first = stations[0]!;
    await render(
      <StationsMap
        stations={stations}
        tiers={{ [first.id]: "live" }}
        selectedId={first.id}
        onSelect={onSelect}
        accessibilityLabel="Stations"
      />,
    );
    await waitFor(() => expect(recorded.maps.length).toBeGreaterThan(0));
    const data = recorded.sources.get("bumelerze-stations")?.data as {
      features: { properties: { id: string; tier: string; selected: boolean } }[];
    };
    expect(data.features).toHaveLength(stations.length);
    expect(data.features[0]?.properties).toEqual({
      id: first.id,
      tier: "live",
      selected: true,
    });
    expect(data.features[1]?.properties.tier).toBe("unknown");
    // One image per tier, at the web's pixel ratio.
    const images = recorded.images[0]?.images as Record<
      string,
      { source: { uri: string; scale: number } }
    >;
    expect(Object.keys(images).sort()).toEqual([
      "station-live",
      "station-recent",
      "station-silent",
      "station-unknown",
    ]);
    expect(images["station-live"]?.source.scale).toBe(2);
    expect(images["station-live"]?.source.uri).toBe(stationIconDataUri("#C3202B"));
    expect(recorded.layers.get("bumelerze-stations-dots")?.layout).toMatchObject({
      "icon-image": ["concat", "station-", ["get", "tier"]],
      "icon-size": ["case", ["get", "selected"], 1.35, 1],
    });
  });

  it("frames the stations with half a degree to spare, and selects a tapped one", async () => {
    const onSelect = jest.fn();
    await render(
      <StationsMap
        stations={stations}
        tiers={{}}
        selectedId={null}
        onSelect={onSelect}
        accessibilityLabel="Stations"
      />,
    );
    await waitFor(() => expect(recorded.maps.length).toBeGreaterThan(0));
    const bounds = (recorded.cameras[0]?.initialViewState as { bounds: number[] }).bounds;
    expect(bounds[0]).toBeCloseTo(Math.min(...stations.map((s) => s.lon)) - 0.5);
    expect(bounds[3]).toBeCloseTo(Math.max(...stations.map((s) => s.lat)) + 0.5);
    const press = recorded.sources.get("bumelerze-stations")?.onPress as (
      e: unknown,
    ) => void;
    await act(async () => {
      press(pressEvent([44, 35], [{ properties: { id: stations[2]!.id } }]));
    });
    expect(onSelect).toHaveBeenCalledWith(stations[2]!.id);
  });
});
