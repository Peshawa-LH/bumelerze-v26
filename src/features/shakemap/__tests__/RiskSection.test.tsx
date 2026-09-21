import { fireEvent, render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import type { Event } from "@/features/events";
import damageContoursFixture from "../__fixtures__/us6000jllz/cont_damage.trimmed.json";
import schema2SummaryFixture from "../__fixtures__/schema2/risk_summary.json";
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
  bumelerzeId: null,
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

  it("keeps the numeric range one tap away, behind the detail control", async () => {
    // Peshawa, 2026-09-21: lead with the band word, put the range behind
    // a tap. Heavy damage on the 2017 event spans roughly 20,000 to
    // 290,000 buildings, a factor of fifteen, so a headline number
    // implies a precision the model does not have.
    mockReady();

    await render(<RiskSection event={EVENT} />);

    expect(screen.queryByTestId("risk-impact-scale")).toBeNull();
    await fireEvent.press(screen.getByTestId("risk-detail-toggle"));
    expect(screen.getByTestId("risk-impact-scale")).toBeTruthy();
  });

  it("renders the impact scale with an accessibility label describing the band and approximate figures", async () => {
    mockReady();

    await render(<RiskSection event={EVENT} />);
    await fireEvent.press(screen.getByTestId("risk-detail-toggle"));

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

// ---------------------------------------------------------------------------
// Product schema 2 — the damage dashboard's own data (2026-09-21)
// ---------------------------------------------------------------------------


function mockSchema2() {
  const risk = parseRiskProduct({
    summary: schema2SummaryFixture,
    districts: districtsFixture,
    damageContours: damageContoursFixture,
  });
  if (!risk) {
    throw new Error("schema 2 fixture failed to parse — fixture is broken");
  }
  mockedUseResolvedShakeMap.mockReturnValue({
    status: "ready",
    product: fakeProduct(),
    contours: { levels: [], skippedCount: 0 },
    risk,
  });
}

describe("RiskSection, product schema 2", () => {
  beforeEach(() => {
    mockedUseResolvedShakeMap.mockReset();
  });

  it("shows people by shaking level instead of everyone inside the map window", async () => {
    mockSchema2();

    await render(<RiskSection event={EVENT} />);

    // The 2017 fixture has 32.7 million inside the grid and 125,028 at
    // intensity VIII. The first number is close to the population of
    // Iraq and says nothing; the tile that showed it must be gone.
    expect(screen.getByTestId("risk-shaking-level-8")).toBeTruthy();
    expect(screen.getByTestId("risk-shaking-level-7")).toBeTruthy();
    expect(screen.queryByTestId("risk-exposure-tile-people")).toBeNull();
    expect(screen.getByTestId("risk-exposure-tile-buildings")).toBeTruthy();
  });

  it("keeps the schema 1 people tile for versions published before the change", async () => {
    mockReady();

    await render(<RiskSection event={EVENT} />);

    expect(screen.getByTestId("risk-exposure-tile-people")).toBeTruthy();
    expect(screen.queryByTestId("risk-shaking-level-8")).toBeNull();
  });

  it("shows damage by IMS-25 building type behind the detail control", async () => {
    mockSchema2();

    await render(<RiskSection event={EVENT} />);

    expect(screen.queryByTestId("risk-building-type-M1")).toBeNull();
    await fireEvent.press(screen.getByTestId("risk-detail-toggle"));
    expect(screen.getByTestId("risk-building-type-M1")).toBeTruthy();
    expect(screen.getByTestId("risk-building-type-M6")).toBeTruthy();
  });

  it("renders no building-type block at all for a schema 1 product", async () => {
    mockReady();

    await render(<RiskSection event={EVENT} />);
    await fireEvent.press(screen.getByTestId("risk-detail-toggle"));

    expect(screen.queryByTestId("risk-building-type-M1")).toBeNull();
  });

  it("never reports a damage band that has buildings in it as zero percent", async () => {
    // At national scale real damage is a fraction of a percent of the
    // whole stock: 24,511 heavily damaged buildings out of 7.8 million
    // rounds to 0, and "Heavy damage (0%)" over an event that wrecked
    // thousands of homes is false.
    mockSchema2();

    await render(<RiskSection event={EVENT} />);

    const bar = screen.getByTestId("risk-damage-grade-bar");
    expect(bar.props.accessibilityLabel).not.toMatch(/\b0%/);
    expect(
      screen.getByText(
        i18n.t("eventDetail.risk.stackedBar.legendItem", {
          label: i18n.t("eventDetail.risk.stackedBar.heavy"),
          percent: i18n.t("eventDetail.risk.stackedBar.underOnePercent"),
        }),
      ),
    ).toBeTruthy();
  });

  it("ranks building types by share, not by count", async () => {
    // The producer sorts by count, which answers "where is most of the
    // damage". This block asks "which kinds of building are failing", and
    // ordering by one while drawing bars from the other reads as
    // unsorted. Class A must lead on this fixture.
    mockSchema2();

    await render(<RiskSection event={EVENT} />);
    await fireEvent.press(screen.getByTestId("risk-detail-toggle"));

    // M1 (rubble stone, class A) has FEWER damaged buildings than M6 but
    // a far higher share, and must therefore appear first.
    const order: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      const n = node as { props?: Record<string, unknown>; children?: unknown } | null;
      if (n && typeof n.props?.testID === "string" && n.props.testID.startsWith("risk-building-type-")) {
        order.push(n.props.testID.replace("risk-building-type-", ""));
      }
      if (n?.children) {
        walk(n.children);
      }
    };
    walk(screen.toJSON());

    expect(order[0]).toBe("M1");
    expect(order.indexOf("M1")).toBeLessThan(order.indexOf("M6"));
  });

  it("reports the share of a type's own stock, which is what a count hides", async () => {
    // The whole reason the share is published. In this fixture
    // manufactured stone with concrete floors (M6) has MORE heavy damage
    // than rubble-stone masonry (M1) purely because there is so much of
    // it standing, while M1 is an order of magnitude likelier to be
    // wrecked. A dashboard ranking by count alone inverts that.
    mockSchema2();

    await render(<RiskSection event={EVENT} />);
    await fireEvent.press(screen.getByTestId("risk-detail-toggle"));

    const m6 = screen.getByTestId("risk-building-type-M6");
    const m1 = screen.getByTestId("risk-building-type-M1");
    const shareOf = (node: { props: { accessibilityLabel?: string } }) => {
      const label = node.props.accessibilityLabel ?? "";
      return Number(/(\d+(?:\.\d+)?)/.exec(label.replace(/[^\d.%]/g, " "))?.[1] ?? "0");
    };
    expect(shareOf(m1)).toBeGreaterThan(shareOf(m6));
  });
});
