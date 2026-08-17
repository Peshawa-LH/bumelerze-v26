import { render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import type { Event } from "@/features/events";
import halabjaContours from "../__fixtures__/us2000bmcg/cont_mi.trimmed.json";
import { parseIntensityContours } from "../contours";
import { ShakeMapSection } from "../components/ShakeMapSection";
import { useResolvedShakeMap } from "../live-queries";
import type { ResolvedShakeMapProduct } from "../resolver";

jest.mock("../live-queries", () => ({
  useResolvedShakeMap: jest.fn(),
}));

const mockedUseResolvedShakeMap = useResolvedShakeMap as jest.MockedFunction<
  typeof useResolvedShakeMap
>;

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

function fakeProduct(overrides: Partial<ResolvedShakeMapProduct> = {}): ResolvedShakeMapProduct {
  return {
    source: "bundled",
    version: 1,
    reviewStatus: "automatic",
    dataUsedSummaryKey: "dyfiConditioned",
    generatedAt: "2026-08-07T00:00:00.000Z",
    engineVersion: null,
    ...overrides,
  };
}

describe("ShakeMapSection", () => {
  beforeEach(() => {
    mockedUseResolvedShakeMap.mockReset();
  });

  it("renders nothing at all for the common absent-product case (no empty shell)", async () => {
    mockedUseResolvedShakeMap.mockReturnValue({
      status: "absent",
      product: null,
      contours: null,
    });

    const { toJSON } = await render(<ShakeMapSection event={HALABJA_EVENT} />);
    expect(toJSON()).toBeNull();
  });

  it("renders the map + version/updated + producer citation when a product is ready", async () => {
    const contours = parseIntensityContours(halabjaContours);
    mockedUseResolvedShakeMap.mockReturnValue({
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

  it("never cites USGS as the producer — always Bumelerze (D21), regardless of source", async () => {
    const contours = parseIntensityContours(halabjaContours);
    mockedUseResolvedShakeMap.mockReturnValue({
      status: "ready",
      product: fakeProduct({ source: "live" }),
      contours,
    });

    await render(<ShakeMapSection event={HALABJA_EVENT} />);

    expect(screen.queryByText(/USGS/)).toBeNull();
  });

  it("shows the data-used summary line matching the product's dataUsedSummaryKey", async () => {
    const contours = parseIntensityContours(halabjaContours);
    mockedUseResolvedShakeMap.mockReturnValue({
      status: "ready",
      product: fakeProduct({ dataUsedSummaryKey: "stationAndDyfiConditioned" }),
      contours,
    });

    await render(<ShakeMapSection event={HALABJA_EVENT} />);

    expect(
      screen.getByText(i18n.t("eventDetail.shakemap.dataUsed.stationAndDyfiConditioned")),
    ).toBeTruthy();
  });

  it("shows the automatic (provisional) review-status badge text by default", async () => {
    const contours = parseIntensityContours(halabjaContours);
    mockedUseResolvedShakeMap.mockReturnValue({
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
    mockedUseResolvedShakeMap.mockReturnValue({
      status: "ready",
      product: fakeProduct({ reviewStatus: "reviewed" }),
      contours,
    });

    await render(<ShakeMapSection event={HALABJA_EVENT} />);

    expect(
      screen.getByText(i18n.t("eventDetail.shakemap.reviewStatus.reviewed")),
    ).toBeTruthy();
  });

  it("shows the engine-version line for a live product that carries one", async () => {
    const contours = parseIntensityContours(halabjaContours);
    mockedUseResolvedShakeMap.mockReturnValue({
      status: "ready",
      product: fakeProduct({
        source: "live",
        engineVersion: {
          serviceVersion: "0.1.0",
          gsimBranches: null,
          emsModel: null,
          mmiModel: null,
          conditioning: null,
        },
      }),
      contours,
    });

    await render(<ShakeMapSection event={HALABJA_EVENT} />);

    expect(
      screen.getByText(i18n.t("eventDetail.shakemap.engineVersion", { version: "0.1.0" })),
    ).toBeTruthy();
  });

  it("omits the engine-version line for a bundled product (no engine-version block carried yet)", async () => {
    const contours = parseIntensityContours(halabjaContours);
    mockedUseResolvedShakeMap.mockReturnValue({
      status: "ready",
      product: fakeProduct({ source: "bundled", engineVersion: null }),
      contours,
    });

    await render(<ShakeMapSection event={HALABJA_EVENT} />);

    expect(
      screen.queryByText(i18n.t("eventDetail.shakemap.engineVersion", { version: "0.1.0" })),
    ).toBeNull();
  });

  it("renders nothing if the mocked hook reports ready but omits product/contours (defensive guard)", async () => {
    mockedUseResolvedShakeMap.mockReturnValue({
      status: "ready",
      product: null,
      contours: null,
    });

    const { toJSON } = await render(<ShakeMapSection event={HALABJA_EVENT} />);
    expect(toJSON()).toBeNull();
  });
});
