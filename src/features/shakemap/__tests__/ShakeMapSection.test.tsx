import { fireEvent, render, screen } from "@testing-library/react-native";
import { Platform } from "react-native";

import i18n from "@/i18n";
import type { Event } from "@/features/events";
import halabjaContours from "../__fixtures__/us2000bmcg/cont_mi.trimmed.json";
import { parseIntensityContours } from "../contours";
import { ShakeMapSection } from "../components/ShakeMapSection";
import { useLiveShakeMapUnavailable, useResolvedShakeMap } from "../live-queries";
import type { ResolvedShakeMapProduct } from "../resolver";

jest.mock("../live-queries", () => ({
  useResolvedShakeMap: jest.fn(),
  useLiveShakeMapUnavailable: jest.fn(),
}));

// Whether a list on this device marked the event with the SHAKEmap tag.
let mockCardHasShakemap = false;
jest.mock("@/features/events", () => ({
  ...jest.requireActual("@/features/events"),
  useCachedHasShakemap: () => mockCardHasShakemap,
}));

// The star's position is a prop on the (real) map view, so capture it
// rather than trying to read a marker out of the rendered tree.
const mockEpicenters: { lat: number; lon: number }[] = [];
jest.mock("../components/ShakeMapView", () => ({
  ShakeMapView: (props: { epicenter: { lat: number; lon: number } }) => {
    mockEpicenters.push(props.epicenter);
    return null;
  },
}));

const mockedUseResolvedShakeMap = useResolvedShakeMap as jest.MockedFunction<
  typeof useResolvedShakeMap
>;
const mockedUseLiveShakeMapUnavailable = useLiveShakeMapUnavailable as jest.MockedFunction<
  typeof useLiveShakeMapUnavailable
>;
const mockRetry = jest.fn();

beforeEach(() => {
  mockCardHasShakemap = false;
  mockRetry.mockClear();
  mockedUseLiveShakeMapUnavailable.mockReturnValue({ unavailable: false, retry: mockRetry });
});

const HALABJA_EVENT: Event = {
  id: "us2000bmcg",
  bumelerzeId: null,
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
      risk: null,
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
      risk: null,
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
      risk: null,
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
      risk: null,
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
      risk: null,
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
      risk: null,
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
      risk: null,
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
      risk: null,
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
      risk: null,
    });

    const { toJSON } = await render(<ShakeMapSection event={HALABJA_EVENT} />);
    expect(toJSON()).toBeNull();
  });
});


/** The star marks the origin of the contours it sits on. It used to come
 * from the event record, which is not always the same agency's solution —
 * it sat up to 21 km off the shaking (2026-09-27). */
describe("ShakeMapSection epicenter", () => {
  beforeEach(() => {
    mockEpicenters.length = 0;
  });

  it("draws the star where the product was computed, not where the record says", async () => {
    const contours = parseIntensityContours(halabjaContours);
    mockedUseResolvedShakeMap.mockReturnValue({
      status: "ready",
      product: fakeProduct(),
      // 21 km from HALABJA_EVENT's own coordinates, the real bml2026025x gap.
      contours: { ...contours, epicenter: { lat: 35.3917, lon: 44.737 } },
      risk: null,
    });

    await render(<ShakeMapSection event={HALABJA_EVENT} />);

    expect(mockEpicenters.at(-1)).toEqual({ lat: 35.3917, lon: 44.737 });
  });

  it("falls back to the event record for a product that predates the field", async () => {
    const contours = parseIntensityContours(halabjaContours);
    mockedUseResolvedShakeMap.mockReturnValue({
      status: "ready",
      product: fakeProduct(),
      contours: { ...contours, epicenter: null },
      risk: null,
    });

    await render(<ShakeMapSection event={HALABJA_EVENT} />);

    expect(mockEpicenters.at(-1)).toEqual({
      lat: HALABJA_EVENT.lat,
      lon: HALABJA_EVENT.lon,
    });
  });
});

describe("ShakeMapSection when the map cannot be had", () => {
  const ABSENT = { status: "absent" as const, product: null, contours: null, risk: null };

  beforeEach(() => {
    mockedUseResolvedShakeMap.mockReturnValue(ABSENT);
  });

  afterEach(async () => {
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });

  // The owner's case (iOS simulator, 2026-10-21): offline, the Home card
  // showed the SHAKEmap tag and the event page dropped the section without
  // a word.
  it("says 'SHAKEmap unavailable offline' with a Retry when the card promised a map", async () => {
    mockCardHasShakemap = true;
    mockedUseLiveShakeMapUnavailable.mockReturnValue({ unavailable: true, retry: mockRetry });

    await render(<ShakeMapSection event={HALABJA_EVENT} />);

    expect(screen.getByText("SHAKEmap")).toBeTruthy();
    expect(screen.getByText("SHAKEmap unavailable offline")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    expect(mockRetry).toHaveBeenCalledTimes(1);
  });

  // Both ways: the web ignores hitSlop, and "Retry" alone is narrower than
  // 44 px.
  it("gives Retry a 44 pt target in real layout", async () => {
    mockCardHasShakemap = true;
    mockedUseLiveShakeMapUnavailable.mockReturnValue({ unavailable: true, retry: mockRetry });

    await render(<ShakeMapSection event={HALABJA_EVENT} />);

    const retry = screen.getByRole("button", { name: "Retry" });
    const style = Array.isArray(retry.props.style)
      ? Object.assign({}, ...retry.props.style)
      : retry.props.style;
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    expect(style.minWidth).toBeGreaterThanOrEqual(44);
  });

  it("says it in Sorani", async () => {
    await i18n.changeLanguage("ckb");
    mockCardHasShakemap = true;
    mockedUseLiveShakeMapUnavailable.mockReturnValue({ unavailable: true, retry: mockRetry });

    await render(<ShakeMapSection event={HALABJA_EVENT} />);

    expect(screen.getByText("نەخشەی لەرزین لە دۆخی ئۆفلاین بەردەست نییە")).toBeTruthy();
  });

  it("stays silent for an event no list marked with the tag (absence over misattribution)", async () => {
    mockCardHasShakemap = false;
    mockedUseLiveShakeMapUnavailable.mockReturnValue({ unavailable: true, retry: mockRetry });

    const { toJSON } = await render(<ShakeMapSection event={HALABJA_EVENT} />);
    expect(toJSON()).toBeNull();
  });

  it("stays silent while the lookup runs or once it answered 'no map'", async () => {
    mockCardHasShakemap = true;
    mockedUseLiveShakeMapUnavailable.mockReturnValue({ unavailable: false, retry: mockRetry });

    const { toJSON } = await render(<ShakeMapSection event={HALABJA_EVENT} />);
    expect(toJSON()).toBeNull();
  });

  // The web dropped the section without a word (the v1 spec §4.5:
  // "shakemap/felt-map/comments show 'unavailable offline' rather than
  // blank/error"); it now says so as iOS and Android do.
  it("says it on the web too, with a Retry that asks again", async () => {
    const original = Platform.OS;
    Platform.OS = "web";
    try {
      mockCardHasShakemap = true;
      mockedUseLiveShakeMapUnavailable.mockReturnValue({ unavailable: true, retry: mockRetry });

      await render(<ShakeMapSection event={HALABJA_EVENT} />);

      expect(screen.getByTestId("shakemap-unavailable")).toBeTruthy();
      expect(screen.getByText("SHAKEmap unavailable offline")).toBeTruthy();
      fireEvent.press(screen.getByRole("button", { name: "Retry" }));
      expect(mockRetry).toHaveBeenCalledTimes(1);
    } finally {
      Platform.OS = original;
    }
  });

  it("stays silent on the web too for an event no list marked with the tag", async () => {
    const original = Platform.OS;
    Platform.OS = "web";
    try {
      mockCardHasShakemap = false;
      mockedUseLiveShakeMapUnavailable.mockReturnValue({ unavailable: true, retry: mockRetry });

      const { toJSON } = await render(<ShakeMapSection event={HALABJA_EVENT} />);
      expect(toJSON()).toBeNull();
    } finally {
      Platform.OS = original;
    }
  });
});

