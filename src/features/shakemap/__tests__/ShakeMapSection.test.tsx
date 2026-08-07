import { render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import type { Event } from "@/features/events";
import halabjaContours from "../__fixtures__/us2000bmcg/cont_mi.trimmed.json";
import { parseIntensityContours } from "../contours";
import { ShakeMapSection } from "../components/ShakeMapSection";
import { useShakeMap } from "../queries";
import type { AtlasBundleEntry } from "../types";

jest.mock("../queries", () => ({
  useShakeMap: jest.fn(),
}));

const mockedUseShakeMap = useShakeMap as jest.MockedFunction<typeof useShakeMap>;

const HALABJA_EVENT: Event = {
  id: "us2000bmcg",
  originTime: 1510510697000,
  lat: 34.9109,
  lon: 45.9592,
  depthKm: 19,
  magnitude: { value: 7.3, type: "mww" },
  placeName: "29 km S of Halabja, Iraq",
  provenance: {
    provider: "usgs",
    providerId: "us2000bmcg",
    fetchedAt: Date.now(),
    providerUpdatedAt: Date.now(),
  },
  sig: 730,
  isRegional: true,
  url: "",
};

function fakeProduct(overrides: Partial<AtlasBundleEntry> = {}): AtlasBundleEntry {
  return {
    eventId: "us2000bmcg",
    producer: "bumelerze",
    version: 1,
    reviewStatus: "automatic",
    dataUsedSummaryKey: "dyfiConditioned",
    generatedAt: "2026-08-07T00:00:00.000Z",
    contours: halabjaContours,
    ...overrides,
  };
}

describe("ShakeMapSection", () => {
  beforeEach(() => {
    mockedUseShakeMap.mockReset();
  });

  it("renders nothing at all for the common absent-product case (no empty shell)", async () => {
    mockedUseShakeMap.mockReturnValue({
      status: "absent",
      product: null,
      contours: null,
    });

    const { toJSON } = await render(<ShakeMapSection event={HALABJA_EVENT} />);
    expect(toJSON()).toBeNull();
  });

  it("renders the map + version/updated + producer citation when a bundled product is ready", async () => {
    const contours = parseIntensityContours(halabjaContours);
    mockedUseShakeMap.mockReturnValue({
      status: "ready",
      product: fakeProduct(),
      contours,
    });

    await render(<ShakeMapSection event={HALABJA_EVENT} />);

    expect(screen.getByText(i18n.t("eventDetail.shakemap.sectionTitle"))).toBeTruthy();
    expect(
      screen.getByText(
        i18n.t("eventDetail.shakemap.citation", { producer: "Bumelerze", version: "1" }),
      ),
    ).toBeTruthy();
  });

  it("never cites USGS as the producer — always Bumelerze (D21)", async () => {
    const contours = parseIntensityContours(halabjaContours);
    mockedUseShakeMap.mockReturnValue({
      status: "ready",
      product: fakeProduct(),
      contours,
    });

    await render(<ShakeMapSection event={HALABJA_EVENT} />);

    expect(screen.queryByText(/USGS/)).toBeNull();
  });

  it("shows the data-used summary line matching the bundled product's dataUsedSummaryKey", async () => {
    const contours = parseIntensityContours(halabjaContours);
    mockedUseShakeMap.mockReturnValue({
      status: "ready",
      product: fakeProduct({ dataUsedSummaryKey: "stationAndDyfiConditioned" }),
      contours,
    });

    await render(<ShakeMapSection event={HALABJA_EVENT} />);

    expect(
      screen.getByText(i18n.t("eventDetail.shakemap.dataUsed.stationAndDyfiConditioned")),
    ).toBeTruthy();
  });

  it("shows the automatic review-status badge text by default", async () => {
    const contours = parseIntensityContours(halabjaContours);
    mockedUseShakeMap.mockReturnValue({
      status: "ready",
      product: fakeProduct({ reviewStatus: "automatic" }),
      contours,
    });

    await render(<ShakeMapSection event={HALABJA_EVENT} />);

    expect(
      screen.getByText(i18n.t("eventDetail.shakemap.reviewStatus.automatic")),
    ).toBeTruthy();
  });

  it("shows the reviewed badge text when the product has been scientist-reviewed", async () => {
    const contours = parseIntensityContours(halabjaContours);
    mockedUseShakeMap.mockReturnValue({
      status: "ready",
      product: fakeProduct({ reviewStatus: "reviewed" }),
      contours,
    });

    await render(<ShakeMapSection event={HALABJA_EVENT} />);

    expect(
      screen.getByText(i18n.t("eventDetail.shakemap.reviewStatus.reviewed")),
    ).toBeTruthy();
  });

  it("renders nothing if the mocked hook reports ready but omits product/contours (defensive guard)", async () => {
    mockedUseShakeMap.mockReturnValue({
      status: "ready",
      product: null,
      contours: null,
    });

    const { toJSON } = await render(<ShakeMapSection event={HALABJA_EVENT} />);
    expect(toJSON()).toBeNull();
  });
});
