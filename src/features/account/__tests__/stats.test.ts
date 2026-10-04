import type { QueueItem } from "@/features/felt";

import { localCounts, mergeWithLocal, parseMyStats } from "../stats";

function item(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    tier1: {
      reportId: "r",
      deviceId: "d",
      eventId: null,
      eventRegistration: null,
      cartoonLevel: 3,
      location: { quality: "gps", lat: 36, lon: 44 },
      feltAt: 1,
      createdAt: 1,
      submittedAt: null,
    },
    tier2: null,
    state: "queued",
    attempts: 0,
    lastAttemptAt: null,
    nextRetryAt: null,
    photoState: null,
    ...overrides,
  };
}

describe("parseMyStats", () => {
  it("reads the one-row result of my_stats()", () => {
    expect(
      parseMyStats([
        {
          member_since: "2026-10-04T10:00:00Z",
          reports: 12,
          detailed_reports: 4,
          photo_reports: 2,
          comments: 9,
          helpful_received: 31,
          family_linked: true,
        },
      ]),
    ).toEqual({
      memberSince: Date.parse("2026-10-04T10:00:00Z"),
      reports: 12,
      detailedReports: 4,
      photoReports: 2,
      comments: 9,
      helpfulReceived: 31,
      familyLinked: true,
    });
  });

  it("accepts a bare object, a null member_since and string numbers", () => {
    const stats = parseMyStats({
      member_since: null,
      reports: "3",
      detailed_reports: 0,
      photo_reports: 0,
      comments: 0,
      helpful_received: 0,
      family_linked: false,
    });
    expect(stats?.memberSince).toBeNull();
    expect(stats?.reports).toBe(3);
    expect(stats?.familyLinked).toBe(false);
  });

  it("turns junk into zeros and rejects a missing row", () => {
    expect(parseMyStats([{ reports: -2, comments: "x" }])?.reports).toBe(0);
    expect(parseMyStats([{ reports: -2, comments: "x" }])?.comments).toBe(0);
    expect(parseMyStats([])).toBeNull();
    expect(parseMyStats(null)).toBeNull();
  });
});

describe("localCounts", () => {
  it("counts reports, detailed answers and photos from the queue", () => {
    const counts = localCounts([
      item(),
      item({ tier2: {} as QueueItem["tier2"] }),
      item({ photoState: "uploaded" }),
      item({ photoState: "pending-upload" }),
      item({ photoState: "failed" }),
    ]);
    expect(counts).toEqual({ reports: 5, detailedReports: 1, photoReports: 2 });
  });
});

describe("mergeWithLocal", () => {
  const local = { reports: 4, detailedReports: 0, photoReports: 1 };

  it("works offline: local numbers, server-only numbers unknown", () => {
    expect(mergeWithLocal(local, null)).toEqual({
      reports: 4,
      detailedReports: 0,
      photoReports: 1,
      comments: null,
      helpfulReceived: null,
      familyLinked: false,
    });
  });

  it("takes max(local, server) so a count never drops after signing in", () => {
    const merged = mergeWithLocal(local, {
      memberSince: null,
      reports: 2,
      detailedReports: 3,
      photoReports: 0,
      comments: 7,
      helpfulReceived: 12,
      familyLinked: true,
    });
    expect(merged.reports).toBe(4);
    expect(merged.detailedReports).toBe(3);
    expect(merged.photoReports).toBe(1);
    expect(merged.comments).toBe(7);
    expect(merged.helpfulReceived).toBe(12);
    expect(merged.familyLinked).toBe(true);
  });
});
