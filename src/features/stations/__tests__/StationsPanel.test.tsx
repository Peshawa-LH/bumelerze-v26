import { cleanup, render, screen } from "@testing-library/react-native";

import { pretendNativeMapLibre } from "@/features/map/__fixtures__/native-maplibre-mock";
import i18n from "@/i18n";
import { StationsPanel } from "../components/StationsPanel";

jest.mock(
  "@maplibre/maplibre-react-native",
  () => jest.requireActual("@/features/map/__fixtures__/native-maplibre-mock").mockModule,
);
jest.mock("../queries", () => ({
  useStationFreshness: () => ({}),
  useStationTrace: () => ({
    status: "idle",
    trace: null,
    freshness: "unknown",
    lagMs: null,
    streaming: false,
  }),
}));
jest.mock("../components/StationsMap", () => {
  const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    StationsMap: (props: { accessibilityLabel: string }) => (
      <Text testID="stations-map">{props.accessibilityLabel}</Text>
    ),
  };
});

describe("StationsPanel on iOS/Android", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });
  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  it("[regression] shows the station map when MapLibre's native code is in the build", async () => {
    pretendNativeMapLibre();
    await render(<StationsPanel />);
    expect(screen.getByTestId("stations-map")).toBeTruthy();
    expect(screen.queryByText(i18n.t("stations.webOnlyMap"))).toBeNull();
  });

  it("keeps the list-only note in Expo Go", async () => {
    await render(<StationsPanel />);
    expect(screen.queryByTestId("stations-map")).toBeNull();
    expect(screen.getByText(i18n.t("stations.webOnlyMap"))).toBeTruthy();
  });
});
