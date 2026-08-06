import { render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import type { Event } from "@/features/events";
import halabjaContours from "../__fixtures__/us2000bmcg/cont_mi.trimmed.json";
import { parseIntensityContours } from "../contours";
import { ShakeMapSection } from "../components/ShakeMapSection";
import { useShakeMap } from "../queries";
import type { ShakeMapProduct } from "../types";

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

const FAKE_PRODUCT: ShakeMapProduct = {
  network: "ATLAS",
  version: 1,
  updateTime: 1594400092790,
  contoursUrl: "https://example.com/cont_mi.json",
  infoUrl: null,
};

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

  it("shows a loading line (with section title) while the lookup is pending", async () => {
    mockedUseShakeMap.mockReturnValue({
      status: "loading",
      product: null,
      contours: null,
    });

    await render(<ShakeMapSection event={HALABJA_EVENT} />);

    expect(screen.getByText(i18n.t("eventDetail.shakemap.sectionTitle"))).toBeTruthy();
    expect(screen.getByText(i18n.t("eventDetail.shakemap.loading"))).toBeTruthy();
  });

  it("shows the offline notice when the lookup failed (never a blank/error)", async () => {
    mockedUseShakeMap.mockReturnValue({
      status: "unavailableOffline",
      product: null,
      contours: null,
    });

    await render(<ShakeMapSection event={HALABJA_EVENT} />);

    expect(
      screen.getByText(i18n.t("eventDetail.shakemap.unavailableOffline")),
    ).toBeTruthy();
  });

  it("renders the map + version/updated + citation line when a product is ready", async () => {
    const contours = parseIntensityContours(halabjaContours);
    mockedUseShakeMap.mockReturnValue({
      status: "ready",
      product: FAKE_PRODUCT,
      contours,
    });

    await render(<ShakeMapSection event={HALABJA_EVENT} />);

    expect(screen.getByText(i18n.t("eventDetail.shakemap.sectionTitle"))).toBeTruthy();
    expect(
      screen.getByText(
        i18n.t("eventDetail.shakemap.citation", { network: "ATLAS", version: "1" }),
      ),
    ).toBeTruthy();
  });
});
