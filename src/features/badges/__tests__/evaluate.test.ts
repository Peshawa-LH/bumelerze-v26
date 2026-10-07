import {
  EMPTY_BADGE_INPUTS,
  countMilestones,
  evaluateBadges,
  mergeBadgeInputs,
} from "../evaluate";
import type { BadgeInputs, MilestoneBadgeEntry } from "../evaluate";

function earnedIds(inputs: Partial<BadgeInputs>): string[] {
  return evaluateBadges({ ...EMPTY_BADGE_INPUTS, ...inputs }, [])
    .filter((entry) => entry.kind === "milestone" && entry.earned)
    .map((entry) => entry.key);
}

describe("evaluateBadges: thresholds", () => {
  it("earns nothing from nothing", () => {
    expect(earnedIds({})).toEqual([]);
  });

  it("first_report at 1 report, reports_10 at 10 (and not at 9)", () => {
    expect(earnedIds({ reports: 0 })).not.toContain("first_report");
    expect(earnedIds({ reports: 1 })).toContain("first_report");
    expect(earnedIds({ reports: 9 })).not.toContain("reports_10");
    expect(earnedIds({ reports: 10 })).toContain("reports_10");
  });

  it("detailed and photo need one report with that content", () => {
    expect(earnedIds({ reports: 3 })).not.toContain("detailed");
    expect(earnedIds({ detailedReports: 1 })).toContain("detailed");
    expect(earnedIds({ photoReports: 1 })).toContain("photo");
  });

  it("home_tagged and family_linked", () => {
    expect(earnedIds({ homeTagged: 1 })).toContain("home_tagged");
    expect(earnedIds({ familyLinked: 1 })).toContain("family_linked");
    expect(earnedIds({ familyLinked: 0 })).not.toContain("family_linked");
  });

  it("first_comment at 1, helpful_5 at 5 (not 4), helpful_25 at 25 (not 24)", () => {
    expect(earnedIds({ comments: 1 })).toContain("first_comment");
    expect(earnedIds({ helpfulReceived: 4 })).not.toContain("helpful_5");
    expect(earnedIds({ helpfulReceived: 5 })).toContain("helpful_5");
    expect(earnedIds({ helpfulReceived: 24 })).not.toContain("helpful_25");
    expect(earnedIds({ helpfulReceived: 25 })).toContain("helpful_25");
  });

  it("reports progress capped at the target", () => {
    const entries = evaluateBadges({ ...EMPTY_BADGE_INPUTS, reports: 3 }, []);
    const ten = entries.find((e) => e.key === "reports_10") as MilestoneBadgeEntry;
    expect(ten.current).toBe(3);
    expect(ten.target).toBe(10);
    expect(ten.earned).toBe(false);
    const over = evaluateBadges({ ...EMPTY_BADGE_INPUTS, reports: 40 }, []).find(
      (e) => e.key === "reports_10",
    ) as MilestoneBadgeEntry;
    expect(over.current).toBe(10);
  });

  it("keeps catalogue order for milestones", () => {
    const keys = evaluateBadges(EMPTY_BADGE_INPUTS, []).map((entry) => entry.key);
    expect(keys[0]).toBe("first_report");
    expect(keys[keys.length - 1]).toBe("helpful_25");
  });

  it("counts earned vs total milestones, never roles", () => {
    const entries = evaluateBadges({ ...EMPTY_BADGE_INPUTS, reports: 1 }, [
      { role: "official", orgName: null },
    ]);
    expect(countMilestones(entries)).toEqual({ earned: 1, total: 9 });
  });
});

describe("mergeBadgeInputs", () => {
  it("takes the larger of local and server for each number", () => {
    const merged = mergeBadgeInputs(
      { ...EMPTY_BADGE_INPUTS, reports: 4, comments: 0, helpfulReceived: 7 },
      { ...EMPTY_BADGE_INPUTS, reports: 2, comments: 3, helpfulReceived: 0 },
    );
    expect(merged.reports).toBe(4);
    expect(merged.comments).toBe(3);
    expect(merged.helpfulReceived).toBe(7);
  });
});

describe("role badges", () => {
  it("come first, in priority order, and only for holders", () => {
    const entries = evaluateBadges(EMPTY_BADGE_INPUTS, [
      { role: "partner", orgName: "Acme" },
      { role: "moderator", orgName: null },
      { role: "official", orgName: null },
    ]);
    expect(entries.slice(0, 3).map((e) => e.key)).toEqual([
      "role-official",
      "role-moderator",
      "role-partner",
    ]);
    expect(entries.some((e) => e.key === "role-engineer")).toBe(false);
    expect(entries.slice(0, 3).every((e) => e.earned)).toBe(true);
    const partner = entries[2];
    expect(partner?.kind === "role" && partner.orgName).toBe("Acme");
  });

  it("order the credential ranks seismologist > professor > researcher > engineer", () => {
    const entries = evaluateBadges(EMPTY_BADGE_INPUTS, [
      { role: "engineer", orgName: null },
      { role: "researcher", orgName: null },
      { role: "seismologist", orgName: null },
      { role: "professor", orgName: null },
    ]);
    expect(entries.slice(0, 4).map((e) => e.key)).toEqual([
      "role-seismologist",
      "role-professor",
      "role-researcher",
      "role-engineer",
    ]);
  });

  it("are absent for a plain account (no locked placeholders)", () => {
    expect(evaluateBadges(EMPTY_BADGE_INPUTS, []).some((e) => e.kind === "role")).toBe(
      false,
    );
    expect(evaluateBadges(EMPTY_BADGE_INPUTS, undefined)).toHaveLength(9);
  });
});

describe("evaluateBadges: requestable ranks", () => {
  const withRanks = (roles: Parameters<typeof evaluateBadges>[1]) =>
    evaluateBadges(EMPTY_BADGE_INPUTS, roles, { includeRequestableRanks: true });
  const roleEntries = (entries: ReturnType<typeof evaluateBadges>) =>
    entries.filter((entry) => entry.kind === "role");

  it("adds the four requestable ranks as locked entries for someone with no roles", () => {
    const ranks = roleEntries(withRanks([]));
    expect(ranks.map((entry) => [entry.key, entry.earned])).toEqual([
      ["role-seismologist", false],
      ["role-professor", false],
      ["role-researcher", false],
      ["role-engineer", false],
    ]);
  });

  it("puts a held rank first and earned, and does not duplicate it as locked", () => {
    const entries = withRanks([{ role: "seismologist", orgName: null }]);
    expect(entries[0]).toMatchObject({ key: "role-seismologist", earned: true });
    expect(entries.filter((entry) => entry.key === "role-seismologist")).toHaveLength(1);
    expect(roleEntries(entries).map((entry) => entry.earned)).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });

  it("never advertises official, moderator or partner, but shows them when held", () => {
    const locked = withRanks([]).map((entry) => entry.key);
    for (const key of ["role-official", "role-moderator", "role-partner"]) {
      expect(locked).not.toContain(key);
    }
    const held = withRanks([
      { role: "official", orgName: null },
      { role: "moderator", orgName: null },
      { role: "partner", orgName: "Org" },
    ]).map((entry) => entry.key);
    expect(held.slice(0, 3)).toEqual(["role-official", "role-moderator", "role-partner"]);
  });

  it("keeps the milestone counter at 0/9 whatever the ranks", () => {
    expect(countMilestones(withRanks([]))).toEqual({ earned: 0, total: 9 });
    expect(countMilestones(withRanks([{ role: "engineer", orgName: null }]))).toEqual({
      earned: 0,
      total: 9,
    });
  });

  it("adds no placeholders unless asked", () => {
    expect(roleEntries(evaluateBadges(EMPTY_BADGE_INPUTS, []))).toEqual([]);
  });
});
