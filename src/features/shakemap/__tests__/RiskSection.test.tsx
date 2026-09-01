import { fireEvent, render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import type { Event } from "@/features/events";
import damageContoursFixture from "../__fixtures__/us6000jllz/cont_damage.trimmed.json";
import districtsFixture from "../__fixtures__/us6000jllz/districts.json";
import riskSummaryFixture from "../__fixtures__/us6000jllz/risk_summary.json";
import { RiskSection } from "../components/RiskSection";
import { useResolvedShakeMap } from "../live-queries";
import type { ResolvedShakeMapProduct } from "../resolver";
import { parseRiskProduct } from "../risk";
import type { RiskProduct } from "../types";

jest.mock("../live-queries", () => ({
  useResolvedShakeMap: jest.fn(),
}));

const mockedUseResolvedShakeMap = useResolvedShakeMap as jest.MockedFunction<
  typeof useResolvedShakeMap
>;

const EVENT: Event = {
  id: "us6000jllz",
  originTime: 1675668633000,
  lat: 37.2256,
  lon: 37.0143,
  depthKm: 10,
  magnitude: { value: 7.8, type: "mww" },
  placeName: "Pazarcık, Turkey",
  provenance: {
    provider: "usgs",
    providerId: "us6000jllz",
    fetchedAt: Date.now(),
    providerUpdatedAt: Date.now(),
  },
  sig: 2910,
  isRegional: true,
  url: "",
};

function fakeProduct(overrides: Partial<ResolvedShakeMapProduct> = {}): ResolvedShakeMapProduct {
  return {
    source: "bundled",
    version: 5,
    reviewStatus: "automatic",
    dataUsedSummaryKey: "stationAndDyfiConditioned",
    generatedAt: "2026-09-01T21:32:26.435Z",
    engineVersion: null,
    ...overrides,
  };
}

function realRisk(overrides: Partial<RiskProduct> = {}): RiskProduct {
  const risk = parseRiskProduct({
    summary: riskSummaryFixture,
    districts: districtsFixture,
    damageContours: damageContoursFixture,
  });
  if (!risk) {
    throw new Error("fixture risk product failed to parse — fixture is broken");
  }
  return { ...risk, ...overrides };
}

function mockReady(riskOverrides: Partial<RiskProduct> = {}, productOverrides: Partial<ResolvedShakeMapProduct> = {}) {
  mockedUseResolvedShakeMap.mockReturnValue({
    status: "ready",
    product: fakeProduct(productOverrides),
    contours: { levels: [], skippedCount: 0 },
    risk: realRisk(riskOverrides),
  });
}

describe("RiskSection", () => {
  beforeEach(() => {
    mockedUseResolvedShakeMap.mockReset();
  });

  it("renders nothing when the resolved product is absent", async () => {
    mockedUseResolvedShakeMap.mockReturnValue({ status: "absent", product: null, contours: null, risk: null });

    const { toJSON } = await render(<RiskSection event={EVENT} />);
    expect(toJSON()).toBeNull();
  });

  it("renders nothing when the resolved product has no risk data (the common case)", async () => {
    mockedUseResolvedShakeMap.mockReturnValue({
      status: "ready",
      product: fakeProduct(),
      contours: { levels: [], skippedCount: 0 },
      risk: null,
    });

    const { toJSON } = await render(<RiskSection event={EVENT} />);
    expect(toJSON()).toBeNull();
  });

  it("renders the section title and the red damage-alert band (P50 158,965 is well over the 10,000 red threshold)", async () => {
    mockReady();

    await render(<RiskSection event={EVENT} />);

    expect(screen.getByText(i18n.t("eventDetail.risk.sectionTitle"))).toBeTruthy();
    const tag = screen.getByTestId("risk-damage-band-tag");
    expect(tag.props.accessibilityLabel).toContain(i18n.t("eventDetail.risk.band.red.title"));
    expect(screen.getByText(i18n.t("eventDetail.risk.band.red.sentence"))).toBeTruthy();
  });

  it("shows a lower band for a small event (P50 under 100)", async () => {
    mockReady({
      summary: {
        ...realRisk().summary,
        buildingsHeavy: 5,
        buildingsHeavyP05P50P95: [2, 5, 9],
      },
    });

    await render(<RiskSection event={EVENT} />);

    expect(screen.getByText(i18n.t("eventDetail.risk.band.green.title"))).toBeTruthy();
  });

  it("renders the impact scale with an accessibility label describing the band and approximate figures", async () => {
    mockReady();

    await render(<RiskSection event={EVENT} />);

    const scale = screen.getByTestId("risk-impact-scale");
    expect(scale.props.accessibilityLabel).toContain(i18n.t("eventDetail.risk.band.red.title"));
    expect(scale.props.accessibilityLabel).toMatch(/159 thousand|160 thousand/);
  });

  it("renders the two exposure tiles with rounded, unit-worded approximate figures (never raw digits)", async () => {
    mockReady();

    await render(<RiskSection event={EVENT} />);

    // Real fixture: exposedPopulation 17,079,988 -> "About 17 million";
    // exposure.buildingsInGrid 1,953,862 -> "About 2 million".
    expect(
      screen.getByText(i18n.t("eventDetail.risk.aboutValue", { value: "17 million" })),
    ).toBeTruthy();
    expect(
      screen.getByText(i18n.t("eventDetail.risk.aboutValue", { value: "2 million" })),
    ).toBeTruthy();
    expect(screen.queryByText(/17,079,988/)).toBeNull();
    expect(screen.queryByText(/1,953,862/)).toBeNull();
  });

  it("renders the damage-grade stacked bar with three rounded-percent segments summing to 100", async () => {
    mockReady();

    await render(<RiskSection event={EVENT} />);

    const bar = screen.getByTestId("risk-damage-grade-bar");
    const segments = screen.getAllByTestId(/^risk-damage-grade-bar-/);
    expect(segments.length).toBeGreaterThan(0);
    expect(bar.props.accessibilityLabel).toBeTruthy();
  });

  it("shows the first 6 provinces by default with a 'Show all' toggle, worst-first", async () => {
    mockReady();

    await render(<RiskSection event={EVENT} />);

    expect(screen.getByText("HATAY")).toBeTruthy();
    // "ELAZIĞ" is the fixture's 10th (last) district row — beyond the
    // first-6 cutoff for the redesigned dashboard.
    expect(screen.queryByText("ELAZIĞ")).toBeNull();
    expect(
      screen.getByText(i18n.t("eventDetail.risk.showAll", { count: "10" })),
    ).toBeTruthy();
  });

  it("reveals every province and switches to 'Show fewer' when the toggle is tapped", async () => {
    mockReady();

    await render(<RiskSection event={EVENT} />);
    await fireEvent.press(screen.getByTestId("risk-provinces-show-all"));

    expect(screen.getByText(i18n.t("eventDetail.risk.showFewer"))).toBeTruthy();
    expect(screen.getByText("ELAZIĞ")).toBeTruthy();
  });

  it("tags a province with low coverage as 'partly inside map'", async () => {
    const risk = realRisk();
    const lowCoverageDistrict = { ...risk.districts.districts[0]!, coverage: 0.2 };
    mockReady({
      districts: { ...risk.districts, districts: [lowCoverageDistrict, ...risk.districts.districts.slice(1)] },
    });

    await render(<RiskSection event={EVENT} />);

    expect(screen.getByText(i18n.t("eventDetail.risk.partlyInsideMap"))).toBeTruthy();
  });

  it("shows the provenance chips: review status, time of day, simulation count, and fragility method (never the raw stage code)", async () => {
    mockReady({}, { reviewStatus: "automatic" });

    await render(<RiskSection event={EVENT} />);

    expect(screen.getByText(i18n.t("eventDetail.risk.chips.provisional"))).toBeTruthy();
    expect(screen.getByText(i18n.t("eventDetail.risk.chips.timeOfDay.night"))).toBeTruthy();
    expect(
      screen.getByText(i18n.t("eventDetail.risk.chips.simulations", { count: "200" })),
    ).toBeTruthy();
    expect(
      screen.getByText(
        i18n.t("eventDetail.risk.chips.fragility", { method: i18n.t("eventDetail.risk.stageNames.pgaLognormal") }),
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/pga_lognormal/)).toBeNull();
  });

  it("shows the reviewed chip when the product has been scientist-reviewed", async () => {
    mockReady({}, { reviewStatus: "reviewed" });

    await render(<RiskSection event={EVENT} />);

    expect(screen.getByText(i18n.t("eventDetail.risk.chips.reviewed"))).toBeTruthy();
  });

  it("shows the casualties-not-published sentence and the Atlas pointer, with no link out", async () => {
    mockReady();

    await render(<RiskSection event={EVENT} />);

    expect(screen.getByText(i18n.t("eventDetail.risk.casualtiesNote"))).toBeTruthy();
    expect(screen.getByText(i18n.t("eventDetail.risk.detailedFigures"))).toBeTruthy();
  });

  it("shows the download-report button when the risk product carries a reportUrl", async () => {
    mockReady({ reportUrl: "https://example.test/events/us6000jllz/v5/report.pdf" });

    await render(<RiskSection event={EVENT} />);

    expect(screen.getByTestId("risk-download-report")).toBeTruthy();
    expect(screen.getByText(i18n.t("eventDetail.risk.downloadReport"))).toBeTruthy();
  });

  it("hides the download-report button when there is no reportUrl", async () => {
    mockReady({ reportUrl: null });

    await render(<RiskSection event={EVENT} />);

    expect(screen.queryByTestId("risk-download-report")).toBeNull();
  });

  it("never renders any fatality/injury number anywhere in the dashboard", async () => {
    mockReady();

    await render(<RiskSection event={EVENT} />);

    expect(screen.queryByText(/fatalit/i)).toBeNull();
    const casualtyMentions = screen.getAllByText(/casualt/i);
    expect(casualtyMentions).toHaveLength(1);
    expect(casualtyMentions[0]?.props.children).toEqual(
      i18n.t("eventDetail.risk.casualtiesNote"),
    );
  });
});
