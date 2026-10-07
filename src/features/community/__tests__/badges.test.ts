import { profileBadgeEntries } from "../badges";
import type { PublicProfile } from "../types";

function profile(
  overrides: Partial<PublicProfile> = {},
  details: Partial<NonNullable<PublicProfile["details"]>> = {},
): PublicProfile {
  return {
    userId: "u1",
    username: "dilan",
    displayName: "Dilan",
    avatarPath: null,
    isPrivate: false,
    roles: [],
    isSelf: false,
    followStatus: "none",
    isBlocked: false,
    canViewFull: true,
    details: {
      memberSince: null,
      followers: 0,
      following: 0,
      comments: 0,
      helpfulReceived: 0,
      badgesHidden: false,
      milestones: { reports: 0, detailedReports: 0, photoReports: 0 },
      recentComments: [],
      ...details,
    },
    ...overrides,
  };
}

const keys = (p: PublicProfile) => profileBadgeEntries(p).map((e) => e.key);

describe("profileBadgeEntries", () => {
  it("shows ranks first, then only the milestone badges that were earned", () => {
    const p = profile(
      { roles: [{ role: "researcher", orgName: null }] },
      {
        comments: 1,
        helpfulReceived: 5,
        milestones: { reports: 10, detailedReports: 1, photoReports: 0 },
      },
    );
    expect(keys(p)).toEqual([
      "role-researcher",
      "first_report",
      "reports_10",
      "detailed",
      "first_comment",
      "helpful_5",
    ]);
  });

  it("never lists the household badges, even if a count would earn them", () => {
    const p = profile(
      {},
      { milestones: { reports: 1, detailedReports: 0, photoReports: 0 } },
    );
    expect(keys(p)).not.toContain("home_tagged");
    expect(keys(p)).not.toContain("family_linked");
  });

  it("hides milestones when the owner chose to, but keeps the rank", () => {
    const p = profile(
      { roles: [{ role: "moderator", orgName: null }] },
      { badgesHidden: true, milestones: null, comments: 4 },
    );
    expect(keys(p)).toEqual(["role-moderator"]);
  });

  it("shows no locked placeholders for someone else's page", () => {
    expect(keys(profile())).toEqual([]);
  });

  it("never includes a locked rank placeholder", () => {
    const p = profile({ roles: [{ role: "engineer", orgName: null }] });
    const ranks = profileBadgeEntries(p).filter((entry) => entry.kind === "role");
    expect(ranks.map((entry) => entry.key)).toEqual(["role-engineer"]);
    expect(ranks.every((entry) => entry.earned)).toBe(true);
    expect(keys(profile())).not.toContain("role-seismologist");
  });
});
