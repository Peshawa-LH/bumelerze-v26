import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import i18n from "@/i18n";
import schema2SummaryFixture from "@/features/shakemap/__fixtures__/schema2/risk_summary.json";
import districtsFixture from "@/features/shakemap/__fixtures__/us6000jllz/districts.json";
import damageContoursFixture from "@/features/shakemap/__fixtures__/us6000jllz/cont_damage.trimmed.json";
import { useResolvedShakeMap } from "@/features/shakemap";
import { parseRiskProduct } from "@/features/shakemap/risk";
import type { ResolvedShakeMapProduct } from "@/features/shakemap";
import type { RiskProduct } from "@/features/shakemap/types";
import {
  makeSocialTransport,
  TIMELINE,
  type FakeSocialData,
} from "@/features/social/__fixtures__/testing";
import {
  collectLabels,
  collectText,
  ROMAN_NUMERAL,
} from "@/features/shakemap/__fixtures__/roman-numerals";

import { HubCarousel, swipeStep } from "../carousel/HubCarousel";
import { buildClassDamage, percentValue, runningTotal } from "../carousel/slide-data";
import { useHubSlides } from "../carousel/use-hub-slides";
import type { HubSummary } from "../types";
import { buildEvent, EMPTY_SUMMARY, renderWithProviders } from "../__fixtures__/testing";

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));

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

const TOWNS = [
  { townId: "halabja", reports: 9, level: 7 },
  { townId: "slemani", reports: 4, level: 5 },
  { townId: "kalar", reports: 1, level: null },
];

/** Numbers are wrapped in direction isolates; the matchers look through them. */
const ISOLATES = /[⁦-⁩]/g;
const plain = (text: string) => text.replace(ISOLATES, "");

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

function Slides({
  summary,
  social,
}: {
  summary: HubSummary | null;
  social: ReturnType<typeof makeSocialTransport>;
}) {
  const slides = useHubSlides({
    event: EVENT,
    shareId: "bml20260042",
    eventUuid: "uuid-1",
    summary,
    transport: social,
  });
  return <HubCarousel slides={slides} />;
}

async function renderSlides(summary: HubSummary | null, data: FakeSocialData = {}) {
  const social = makeSocialTransport(data);
  await renderWithProviders(<Slides summary={summary} social={social} />);
  return social;
}

function slideKeys(): string[] {
  return screen
    .getAllByTestId(/^hub-carousel-dot-/)
    .map((dot) => String(dot.props.testID).replace("hub-carousel-dot-", ""));
}

function counter(): string {
  return plain(collectText(screen.getByTestId("hub-carousel-counter")).join(""));
}

function slideLabel(): string {
  const frame = screen.getByTestId(/^hub-carousel-slide-/);
  return plain(String(frame.props.accessibilityLabel));
}

function labels(): string[] {
  return collectLabels(screen.toJSON()).map(plain);
}

describe("Event hub slides (review note 4.3)", () => {
  beforeEach(async () => {
    mockedUseResolvedShakeMap.mockReset();
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("always has the share image first, alone without dots or counter when nothing else has data", async () => {
    mockRisk(null);
    await renderSlides(EMPTY_SUMMARY);
    expect(await screen.findByTestId("slide-share-image")).toBeTruthy();
    expect(screen.queryByTestId("hub-carousel-counter")).toBeNull();
    expect(screen.queryByTestId("hub-carousel-dot-share")).toBeNull();
  });

  it("never asks for the aggregates when the event has no felt reports", async () => {
    mockRisk(null);
    const social = await renderSlides(EMPTY_SUMMARY, {
      towns: TOWNS,
      timeline: TIMELINE,
    });
    await screen.findByTestId("slide-share-image");
    expect(social.fetchFeltTowns).not.toHaveBeenCalled();
    expect(social.fetchFeltTimeline).not.toHaveBeenCalled();
  });

  it("a fresh event with reports but no damage run: share, towns, timeline (1/3)", async () => {
    mockRisk(null);
    await renderSlides(FELT_SUMMARY, { towns: TOWNS, timeline: TIMELINE });
    expect(await screen.findByTestId("hub-carousel-dot-timeline")).toBeTruthy();
    expect(slideKeys()).toEqual(["share", "towns", "timeline"]);
    expect(counter()).toBe("1/3");
  });

  it("a memory event never gets Reports over time (and does not ask for it)", async () => {
    mockRisk(risk());
    const social = await renderSlides(
      { ...FELT_SUMMARY, featured: true },
      { towns: TOWNS, timeline: TIMELINE },
    );
    expect(await screen.findByTestId("hub-carousel-dot-towns")).toBeTruthy();
    // Halabja 2017 in the mockup: slides 1, 2, 3 and 5, counter 1/4.
    expect(slideKeys()).toEqual(["share", "impact", "towns", "classes"]);
    expect(counter()).toBe("1/4");
    expect(social.fetchFeltTimeline).not.toHaveBeenCalled();
  });

  it("all five, in the fixed order, when everything has data", async () => {
    mockRisk(risk());
    await renderSlides(FELT_SUMMARY, { towns: TOWNS, timeline: TIMELINE });
    expect(await screen.findByTestId("hub-carousel-dot-timeline")).toBeTruthy();
    expect(slideKeys()).toEqual(["share", "impact", "towns", "timeline", "classes"]);
  });

  it("a dot and the accessibility actions move between slides, spoken with the position", async () => {
    mockRisk(risk());
    await renderSlides(FELT_SUMMARY, { towns: TOWNS, timeline: TIMELINE });
    fireEvent.press(await screen.findByTestId("hub-carousel-dot-towns"));
    expect(await screen.findByTestId("slide-towns")).toBeTruthy();
    expect(slideLabel()).toBe("Felt shaking by town, slide 3 of 5");
    expect(counter()).toBe("3/5");
    await act(async () => {
      // Called directly: the frame is also the swipe's responder, which
      // the testing library treats as "not accepting events".
      screen
        .getByTestId("hub-carousel-slide-towns")
        .props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } });
    });
    expect(await screen.findByTestId("slide-timeline")).toBeTruthy();
    await act(async () => {
      // Called directly: the frame is also the swipe's responder, which
      // the testing library treats as "not accepting events".
      screen
        .getByTestId("hub-carousel-slide-timeline")
        .props.onAccessibilityAction({ nativeEvent: { actionName: "decrement" } });
    });
    expect(await screen.findByTestId("slide-towns")).toBeTruthy();
  });

  it("Felt shaking by town shows a level only with 3 reports, always with numeral and name", async () => {
    mockRisk(null);
    await renderSlides(FELT_SUMMARY, { towns: TOWNS });
    fireEvent.press(await screen.findByTestId("hub-carousel-dot-towns"));
    expect(await screen.findByTestId("slide-town-halabja")).toBeTruthy();
    expect(labels()).toContain(
      `Halabja: level VII, ${i18n.t("felt.tier1.levels.7.label")}, 9 reports`,
    );
    expect(labels()).toContain("Kalar: 1 reports, too few for a level");
  });

  it("Reports over time shows the first day, the minutes to the first report and the first hour", async () => {
    mockRisk(null);
    await renderSlides(FELT_SUMMARY, { timeline: TIMELINE });
    fireEvent.press(await screen.findByTestId("hub-carousel-dot-timeline"));
    await screen.findByTestId("slide-timeline");
    expect(labels()).toEqual(
      expect.arrayContaining([
        "7 reports",
        "4 min to the first report",
        "4 in the first hour",
      ]),
    );
  });

  it("drops the not-reviewed wording for a reviewed product", async () => {
    mockRisk(risk(), { reviewStatus: "reviewed" });
    await renderSlides(EMPTY_SUMMARY);
    fireEvent.press(await screen.findByTestId("hub-carousel-dot-impact"));
    expect(await screen.findByText(i18n.t("eventHub.impact.noteReviewed"))).toBeTruthy();
    expect(screen.queryByText(i18n.t("eventHub.impact.note"))).toBeNull();
  });

  it("Impact at a glance keeps one donut when the other has no data", async () => {
    mockRisk(risk({ buildings_by_grade: undefined }));
    await renderSlides(EMPTY_SUMMARY);
    fireEvent.press(await screen.findByTestId("hub-carousel-dot-impact"));
    expect(await screen.findByTestId("hub-impact-people")).toBeTruthy();
    expect(screen.queryByTestId("hub-impact-damage")).toBeNull();
  });

  it("carries no casualty wording", async () => {
    mockRisk(risk());
    await renderSlides(FELT_SUMMARY, { towns: TOWNS, timeline: TIMELINE });
    for (const key of ["impact", "towns", "timeline", "classes"]) {
      fireEvent.press(await screen.findByTestId(`hub-carousel-dot-${key}`));
      await screen.findByTestId(`slide-${key}`);
      expect(screen.queryByText(/casualt|death|killed|injur/i)).toBeNull();
    }
  });

  describe("in Sorani", () => {
    afterEach(async () => {
      cleanup();
      await i18n.changeLanguage("en");
    });

    it("counts in Eastern Arabic digits and never writes levels as Roman numerals", async () => {
      await i18n.changeLanguage("ckb");
      mockRisk(risk());
      await renderSlides(FELT_SUMMARY, { towns: TOWNS, timeline: TIMELINE });
      await waitFor(() => expect(counter()).toBe("١/٥"));
      for (const key of ["impact", "towns"]) {
        fireEvent.press(await screen.findByTestId(`hub-carousel-dot-${key}`));
        await screen.findByTestId(`slide-${key}`);
        const tree = screen.toJSON();
        const texts = [...collectText(tree), ...collectLabels(tree)];
        expect(texts.filter((text) => ROMAN_NUMERAL.test(text))).toEqual([]);
      }
    });
  });
});

describe("swipeStep", () => {
  it("moves on with a swipe to the left in English, to the right in Sorani and Arabic", () => {
    expect(swipeStep(-80, false)).toBe(1);
    expect(swipeStep(80, false)).toBe(-1);
    expect(swipeStep(80, true)).toBe(1);
    expect(swipeStep(-80, true)).toBe(-1);
  });

  it("ignores a short swipe", () => {
    expect(swipeStep(20, false)).toBe(0);
    expect(swipeStep(-40, true)).toBe(0);
  });
});

describe("slide data", () => {
  it("sums the damage per vulnerability class through the type catalogue", () => {
    const rows = buildClassDamage(risk().summary);
    expect(rows.length).toBeGreaterThan(0);
    const letters = rows.map((row) => row.vulnerabilityClass);
    expect(letters).toEqual([...letters].sort());
    for (const row of rows) {
      expect(row.shares.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1 + 1e-9);
      expect(row.dg4Plus).toBeCloseTo(row.shares[3] + row.shares[4]);
    }
  });

  it("has no rows without per-type grades (older products), so the slide stays away", () => {
    expect(buildClassDamage(risk({ buildings_by_type: undefined }).summary)).toEqual([]);
    expect(buildClassDamage(null)).toEqual([]);
  });

  it("keeps a running total and writes tiny shares as <1", () => {
    expect(runningTotal([4, 0, 2, 1])).toEqual([4, 4, 6, 7]);
    expect(percentValue(0.001)).toBe("<1");
    expect(percentValue(0)).toBe("0");
    expect(percentValue(0.164)).toBe("16");
  });
});
