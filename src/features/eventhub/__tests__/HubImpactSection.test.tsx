import { cleanup, render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import schema2SummaryFixture from "@/features/shakemap/__fixtures__/schema2/risk_summary.json";
import districtsFixture from "@/features/shakemap/__fixtures__/us6000jllz/districts.json";
import damageContoursFixture from "@/features/shakemap/__fixtures__/us6000jllz/cont_damage.trimmed.json";
import { useResolvedShakeMap } from "@/features/shakemap";
import { parseRiskProduct } from "@/features/shakemap/risk";
import type { ResolvedShakeMapProduct } from "@/features/shakemap";
import type { RiskProduct } from "@/features/shakemap/types";

import { HubImpactSection } from "../components/HubImpactSection";
import type { HubSummary } from "../types";
import { buildEvent, EMPTY_SUMMARY } from "../__fixtures__/testing";

jest.mock("@/features/shakemap/live-queries", () => ({
  ...jest.requireActual("@/features/shakemap/live-queries"),
  useResolvedShakeMap: jest.fn(),
}));

const mockedUseResolvedShakeMap = useResolvedShakeMap as jest.MockedFunction<
  typeof useResolvedShakeMap
>;

const EVENT = buildEvent();

const FELT_SUMMARY: HubSummary = {
  ...EMPTY_SUMMARY,
  reports: 10,
  people: 9,
  levels: { 2: 4, 5: 6 },
};

function product(
  overrides: Partial<ResolvedShakeMapProduct> = {},
): ResolvedShakeMapProduct {
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

function risk(summaryOverrides: Record<string, unknown> = {}): RiskProduct {
  const parsed = parseRiskProduct({
    summary: { ...schema2SummaryFixture, ...summaryOverrides },
    districts: districtsFixture,
    damageContours: damageContoursFixture,
  });
  if (!parsed) {
    throw new Error("fixture risk product failed to parse");
  }
  return parsed;
}

function mockRisk(
  riskProduct: RiskProduct | null,
  productOverrides: Partial<ResolvedShakeMapProduct> = {},
) {
  mockedUseResolvedShakeMap.mockReturnValue(
    riskProduct
      ? {
          status: "ready",
          product: product(productOverrides),
          contours: { levels: [], skippedCount: 0, epicenter: null },
          risk: riskProduct,
        }
      : { status: "absent", product: null, contours: null, risk: null },
  );
}

describe("HubImpactSection", () => {
  beforeEach(async () => {
    mockedUseResolvedShakeMap.mockReset();
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("renders nothing when no chart has data", async () => {
    mockRisk(null);
    const { toJSON } = await render(<HubImpactSection event={EVENT} summary={EMPTY_SUMMARY} />);
    expect(toJSON()).toBeNull();
  });

  it("renders nothing while the hub summary is unknown and there is no risk product", async () => {
    mockRisk(null);
    const { toJSON } = await render(<HubImpactSection event={EVENT} summary={null} />);
    expect(toJSON()).toBeNull();
  });

  it("shows only the felt chart when there is no risk product", async () => {
    mockRisk(null);
    await render(<HubImpactSection event={EVENT} summary={FELT_SUMMARY} />);
    expect(screen.getByTestId("hub-impact-felt")).toBeTruthy();
    expect(screen.queryByTestId("hub-impact-damage")).toBeNull();
    expect(screen.queryByTestId("hub-impact-people")).toBeNull();
    expect(screen.queryByTestId("hub-impact-note")).toBeNull();
    expect(screen.getByText("What people felt")).toBeTruthy();
    // Felt legend reuses the felt-flow level labels.
    expect(screen.getByText(i18n.t("felt.tier1.levels.2.label"))).toBeTruthy();
    expect(screen.getByText(i18n.t("felt.tier1.levels.5.label"))).toBeTruthy();
  });

  it("shows damage and people charts with the automatic note when there are no felt reports", async () => {
    mockRisk(risk());
    await render(<HubImpactSection event={EVENT} summary={EMPTY_SUMMARY} />);
    expect(screen.queryByTestId("hub-impact-felt")).toBeNull();
    expect(screen.getByTestId("hub-impact-damage")).toBeTruthy();
    expect(screen.getByTestId("hub-impact-people")).toBeTruthy();
    expect(screen.getByTestId("hub-impact-note")).toHaveTextContent(
      i18n.t("eventHub.impact.note"),
    );
    // Same bands and labels as the event page's damage bar.
    expect(screen.getByText(i18n.t("eventDetail.risk.stackedBar.little"))).toBeTruthy();
    expect(screen.getByText(i18n.t("eventDetail.risk.stackedBar.moderate"))).toBeTruthy();
    expect(screen.getByText(i18n.t("eventDetail.risk.stackedBar.heavy"))).toBeTruthy();
    expect(screen.getByText(i18n.t("eventDetail.risk.stackedBar.severe"))).toBeTruthy();
  });

  it("shows all three charts when everything has data", async () => {
    mockRisk(risk());
    await render(<HubImpactSection event={EVENT} summary={FELT_SUMMARY} />);
    expect(screen.getByTestId("hub-impact-felt")).toBeTruthy();
    expect(screen.getByTestId("hub-impact-damage")).toBeTruthy();
    expect(screen.getByTestId("hub-impact-people")).toBeTruthy();
    expect(screen.getAllByTestId("hub-impact-note")).toHaveLength(1);
  });

  it("drops the not-reviewed wording for a reviewed product", async () => {
    mockRisk(risk(), { reviewStatus: "reviewed" });
    await render(<HubImpactSection event={EVENT} summary={EMPTY_SUMMARY} />);
    expect(screen.getByTestId("hub-impact-note")).toHaveTextContent(
      i18n.t("eventHub.impact.noteReviewed"),
    );
  });

  it("hides the damage chart when the grade counts are null", async () => {
    mockRisk(risk({ buildings_by_grade: undefined }));
    await render(<HubImpactSection event={EVENT} summary={EMPTY_SUMMARY} />);
    expect(screen.queryByTestId("hub-impact-damage")).toBeNull();
    expect(screen.getByTestId("hub-impact-people")).toBeTruthy();
  });

  it("hides the people chart when the population split is null", async () => {
    mockRisk(risk({ population_by_intensity_band: undefined }));
    await render(<HubImpactSection event={EVENT} summary={EMPTY_SUMMARY} />);
    expect(screen.queryByTestId("hub-impact-people")).toBeNull();
    expect(screen.getByTestId("hub-impact-damage")).toBeTruthy();
  });

  it("splits people by shaking level, strongest first, from level IV up", async () => {
    mockRisk(risk());
    await render(<HubImpactSection event={EVENT} summary={EMPTY_SUMMARY} />);
    // Fixture: levels 3 (14 people, below the floor), 4..8. The three
    // largest keep their own row, the two strongest fall into "Other".
    expect(screen.getByTestId("donut-slice-degree-5")).toBeTruthy();
    expect(screen.getByTestId("donut-slice-degree-6")).toBeTruthy();
    expect(screen.getByTestId("donut-slice-degree-4")).toBeTruthy();
    expect(screen.getByTestId("donut-slice-other")).toBeTruthy();
    expect(screen.queryByTestId("donut-slice-degree-3")).toBeNull();
  });

  it("carries no casualty wording", async () => {
    mockRisk(risk());
    await render(<HubImpactSection event={EVENT} summary={FELT_SUMMARY} />);
    expect(screen.queryByText(/casualt|death|killed|injur/i)).toBeNull();
  });
});
