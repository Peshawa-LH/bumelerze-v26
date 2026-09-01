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

function realRisk(): RiskProduct {
  const risk = parseRiskProduct({
    summary: riskSummaryFixture,
    districts: districtsFixture,
    damageContours: damageContoursFixture,
  });
  if (!risk) {
    throw new Error("fixture risk product failed to parse — fixture is broken");
  }
  return risk;
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

  it("renders the section title and headline with the real (trimmed) us6000jllz numbers", async () => {
    mockedUseResolvedShakeMap.mockReturnValue({
      status: "ready",
      product: fakeProduct(),
      contours: { levels: [], skippedCount: 0 },
      risk: realRisk(),
    });

    await render(<RiskSection event={EVENT} />);

    expect(screen.getByText(i18n.t("eventDetail.risk.sectionTitle"))).toBeTruthy();
    expect(
      screen.getByText(
        i18n.t("eventDetail.risk.headline", { p50: "158,965", p05: "116,423", p95: "209,051" }),
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(i18n.t("eventDetail.risk.exposedPopulation", { count: "17,079,988" })),
    ).toBeTruthy();
  });

  it("shows the first 8 districts by default with a 'Show all (10)' toggle, worst-first", async () => {
    mockedUseResolvedShakeMap.mockReturnValue({
      status: "ready",
      product: fakeProduct(),
      contours: { levels: [], skippedCount: 0 },
      risk: realRisk(),
    });

    await render(<RiskSection event={EVENT} />);

    expect(screen.getByText("HATAY")).toBeTruthy();
    // "ELAZIĞ" is the fixture's 10th (last) district row — beyond the
    // first-8 cutoff, must not render until "Show all" is tapped.
    expect(screen.queryByText("ELAZIĞ")).toBeNull();
    expect(
      screen.getByText(i18n.t("eventDetail.risk.showAll", { count: "10" })),
    ).toBeTruthy();
  });

  it("reveals every district and switches to 'Show fewer' when the toggle is tapped", async () => {
    mockedUseResolvedShakeMap.mockReturnValue({
      status: "ready",
      product: fakeProduct(),
      contours: { levels: [], skippedCount: 0 },
      risk: realRisk(),
    });

    await render(<RiskSection event={EVENT} />);
    await fireEvent.press(screen.getByTestId("risk-districts-show-all"));

    expect(screen.getByText(i18n.t("eventDetail.risk.showFewer"))).toBeTruthy();
    // All 10 fixture districts now visible — the 10th one wasn't shown
    // before the toggle.
    expect(districtsFixture.districts).toHaveLength(10);
    for (const district of districtsFixture.districts) {
      expect(screen.getByText(district.adm1_name)).toBeTruthy();
    }
  });

  it("shows the provenance block: fragility stage, draw count, time-of-day snapshot, review status, and the casualties-not-published sentence", async () => {
    mockedUseResolvedShakeMap.mockReturnValue({
      status: "ready",
      product: fakeProduct({ reviewStatus: "automatic" }),
      contours: { levels: [], skippedCount: 0 },
      risk: realRisk(),
    });

    await render(<RiskSection event={EVENT} />);

    expect(
      screen.getByText(i18n.t("eventDetail.risk.provenance.stage", { stage: "pga_lognormal" })),
    ).toBeTruthy();
    expect(
      screen.getByText(i18n.t("eventDetail.risk.provenance.draws", { count: "200" })),
    ).toBeTruthy();
    expect(
      screen.getByText(i18n.t("eventDetail.risk.provenance.timeOfDay.night")),
    ).toBeTruthy();
    expect(
      screen.getByText(i18n.t("eventDetail.shakemap.reviewStatus.automatic")),
    ).toBeTruthy();
    expect(screen.getByText(i18n.t("eventDetail.risk.casualtiesNote"))).toBeTruthy();
  });

  it("never renders any fatality/injury number — only the fixed 'not published' sentence", async () => {
    mockedUseResolvedShakeMap.mockReturnValue({
      status: "ready",
      product: fakeProduct(),
      contours: { levels: [], skippedCount: 0 },
      risk: realRisk(),
    });

    await render(<RiskSection event={EVENT} />);

    expect(screen.queryByText(/fatalit/i)).toBeNull();
    // The one and only "casualt*" mention is the fixed policy sentence.
    const casualtyMentions = screen.getAllByText(/casualt/i);
    expect(casualtyMentions).toHaveLength(1);
    expect(casualtyMentions[0]?.props.children).toEqual(
      i18n.t("eventDetail.risk.casualtiesNote"),
    );
  });
});
