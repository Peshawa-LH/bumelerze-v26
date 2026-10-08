import { summarizeFamilyStatus } from "../family-status";
import type { FamilyCheckIn } from "../transport";

const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
const HOUR = 3_600_000;

const QUAKE_1 = {
  eventId: "e1",
  bumelerzeId: "bml1",
  magnitude: 5.1,
  place: "Halabja",
  originTime: NOW - 6 * HOUR,
};
const QUAKE_2 = {
  eventId: "e2",
  bumelerzeId: "bml2",
  magnitude: 4.6,
  place: "Halabja",
  originTime: NOW - 2 * HOUR,
};

function c(userId: string, hoursAgo: number, event = QUAKE_1): FamilyCheckIn {
  return { userId, checkedInAt: NOW - hoursAgo * HOUR, event };
}

describe("family status summary", () => {
  it("counts who checked in for the latest earthquake: '3 of 4'", () => {
    const s = summarizeFamilyStatus(
      {
        myShare: true,
        sharing: ["me", "a", "b", "c"],
        checkins: [c("me", 1, QUAKE_2), c("a", 1.5, QUAKE_2), c("b", 1.9, QUAKE_1)],
      },
      NOW,
    );
    expect(s.focus?.eventId).toBe("e2");
    // b's check-in was tied to the first quake but made after the second one.
    expect(s.members.map((m) => [m.userId, m.state])).toEqual([
      ["me", "safe"],
      ["a", "safe"],
      ["b", "safe"],
      ["c", "none"],
    ]);
    expect([s.checkedIn, s.total]).toEqual([3, 4]);
  });

  it("a check-in older than a later earthquake is 'before' (greyed), not safe", () => {
    const s = summarizeFamilyStatus(
      { myShare: true, sharing: ["a", "b"], checkins: [c("a", 5), c("b", 1, QUAKE_2)] },
      NOW,
    );
    expect(s.members.find((m) => m.userId === "a")?.state).toBe("before");
    expect(s.checkedIn).toBe(1);
  });

  it("older than 24 hours: 'earlier', and no focus, so no chip", () => {
    const s = summarizeFamilyStatus(
      { myShare: true, sharing: ["a", "b"], checkins: [c("a", 30)] },
      NOW,
    );
    expect(s.focus).toBeNull();
    expect(s.members.map((m) => m.state)).toEqual(["earlier", "none"]);
  });

  it("people the reader may not see are not counted (switch off, blocked)", () => {
    const s = summarizeFamilyStatus(
      { myShare: true, sharing: ["me"], checkins: [c("me", 1), c("hidden", 1)] },
      NOW,
    );
    expect(s.members.map((m) => m.userId)).toEqual(["me"]);
    expect(s.total).toBe(1);
  });

  it("never carries a location (the data has none to carry)", () => {
    const s = summarizeFamilyStatus(
      { myShare: true, sharing: ["a"], checkins: [c("a", 1)] },
      NOW,
    );
    expect(JSON.stringify(s)).not.toMatch(/"(lat|lon|geohash|location|device)/);
  });
});
