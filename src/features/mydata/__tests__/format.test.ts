import i18n from "@/i18n";
import type { EventRegistration, QueueItem, Tier1Report, Tier2Report } from "@/features/felt";

import { buildContributionRow, formatContributorId, resolveSyncStatus } from "../format";

/**
 * Pure view-model logic for the My Data screen (D26 item 7). No rendering
 * here — `ContributionRow.test.tsx` covers the component that consumes
 * this output.
 */

const SAMPLE_TIER1: Tier1Report = {
  reportId: "report-1",
  deviceId: "abcdef1234567890",
  eventId: null,
  eventRegistration: null,
  cartoonLevel: 4,
  location: { quality: "gps", lat: 36.19, lon: 44.01 },
  feltAt: 1_700_000_000_000,
  createdAt: 1_700_000_000_000,
  submittedAt: null,
};

const SAMPLE_EVENT_REGISTRATION: EventRegistration = {
  provider: "usgs",
  providerId: "us1000abcd",
  originTime: 1_699_999_000_000,
  lat: 35.56,
  lon: 45.43,
  depthKm: 10,
  magnitude: 5.4,
  magType: "mww",
  placeName: "32 km SE of Halabja, Iraq",
};

function makeQueueItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    tier1: SAMPLE_TIER1,
    tier2: null,
    state: "queued",
    attempts: 0,
    lastAttemptAt: null,
    nextRetryAt: null,
    ...overrides,
  };
}

const SAMPLE_TIER2: Tier2Report = {
  detailId: "detail-1",
  feltReportId: "report-1",
  deviceId: "abcdef1234567890",
  answers: {
    situation: "inside",
    felt: "yes",
    othersFelt: "most",
    motion: "strong",
    reaction: "noticed",
    stand: "no",
    shelf: "no",
    picture: "no",
    furniture: "no",
    buildingDamageLevel: 2,
    damageTypology: "lowrise",
    roadDamageLevel: 0,
    comment: null,
  },
  photoUri: null,
  createdAt: 1_700_000_001_000,
};

describe("formatContributorId", () => {
  it("returns the first 8 characters of the device id, uppercased", () => {
    expect(formatContributorId("abcdef1234567890")).toBe("ABCDEF12");
  });

  it("never returns the full device id, even for a short one", () => {
    expect(formatContributorId("abc")).toBe("ABC");
  });
});

describe("resolveSyncStatus", () => {
  it("reports 'submitted' only for the submitted queue state", () => {
    expect(resolveSyncStatus(makeQueueItem({ state: "submitted" }))).toBe("submitted");
  });

  it.each(["queued", "syncing", "awaiting-backend", "failed"] as const)(
    "reports 'on-device' for the %s queue state",
    (state) => {
      expect(resolveSyncStatus(makeQueueItem({ state }))).toBe("on-device");
    },
  );
});

describe("buildContributionRow", () => {
  const originalLanguage = i18n.language;

  afterEach(async () => {
    await i18n.changeLanguage(originalLanguage);
  });

  it("builds a row with no event/damage for a bare tier-1-only, unassigned report", () => {
    const row = buildContributionRow(makeQueueItem(), "en", i18n.t.bind(i18n));

    expect(row.reportId).toBe("report-1");
    expect(row.eventLabel).toBeNull();
    expect(row.level).toBe(4);
    expect(row.levelLabel).toBe("4 - Felt by many");
    expect(row.damage).toBeNull();
    expect(row.syncStatus).toBe("on-device");
    expect(row.syncStatusText).toBe("On this device");
    expect(row.dateText.length).toBeGreaterThan(0);
  });

  it("surfaces the event's place name when the report carries an eventRegistration snapshot", () => {
    const item = makeQueueItem({
      tier1: { ...SAMPLE_TIER1, eventId: "us1000abcd", eventRegistration: SAMPLE_EVENT_REGISTRATION },
    });
    const row = buildContributionRow(item, "en", i18n.t.bind(i18n));

    expect(row.eventLabel).toBe("32 km SE of Halabja, Iraq");
  });

  it("surfaces the damage grade/typology once tier-2 has been attached", () => {
    const item = makeQueueItem({ tier2: SAMPLE_TIER2, state: "submitted" });
    const row = buildContributionRow(item, "en", i18n.t.bind(i18n));

    expect(row.damage).toEqual({
      typology: "lowrise",
      grade: 2,
      label: "Large wall cracks, some fallen plaster or masonry",
      typologyLabel: "Single-storey or low-rise building (Iraqi-typical)",
    });
    expect(row.syncStatus).toBe("submitted");
    expect(row.syncStatusText).toBe("Submitted");
  });

  it("omits the damage row for the generic 'no damage' shortcut (grade 0, no typology)", () => {
    const item = makeQueueItem({
      tier2: {
        ...SAMPLE_TIER2,
        answers: { ...SAMPLE_TIER2.answers, buildingDamageLevel: 0, damageTypology: null },
      },
    });
    const row = buildContributionRow(item, "en", i18n.t.bind(i18n));

    expect(row.damage).toBeNull();
  });

  it("localizes the level numeral for Sorani (Eastern Arabic-Indic digits)", async () => {
    await i18n.changeLanguage("ckb");
    const row = buildContributionRow(makeQueueItem(), "ckb", i18n.t.bind(i18n));

    expect(row.levelLabel.startsWith("٤")).toBe(true);
  });
});
