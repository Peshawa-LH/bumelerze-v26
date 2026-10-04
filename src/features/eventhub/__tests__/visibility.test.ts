import { HUB_RECENT_WINDOW_MS, shouldShowHubPill } from "../visibility";

const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

describe("shouldShowHubPill", () => {
  const base = { isRegional: true, nowMs: NOW };

  it("is 72 hours", () => {
    expect(HUB_RECENT_WINDOW_MS).toBe(72 * HOUR);
  });

  it("never shows for a non-regional event", () => {
    expect(
      shouldShowHubPill({
        ...base,
        isRegional: false,
        originTime: NOW - HOUR,
        summary: { reports: 40, comments: 5 },
      }),
    ).toBe(false);
  });

  it("shows for a recent regional event with no activity or no summary yet", () => {
    expect(
      shouldShowHubPill({ ...base, originTime: NOW - 2 * HOUR, summary: null }),
    ).toBe(true);
    expect(
      shouldShowHubPill({
        ...base,
        originTime: NOW - 2 * HOUR,
        summary: { reports: 0, comments: 0 },
      }),
    ).toBe(true);
  });

  it("shows at exactly 72 hours and hides just after, when there is no activity", () => {
    const quiet = { reports: 0, comments: 0 };
    expect(
      shouldShowHubPill({ ...base, originTime: NOW - 72 * HOUR, summary: quiet }),
    ).toBe(true);
    expect(
      shouldShowHubPill({ ...base, originTime: NOW - 72 * HOUR - 1, summary: quiet }),
    ).toBe(false);
  });

  it("shows an old regional event once it has reports or comments", () => {
    const old = NOW - 30 * 24 * HOUR;
    expect(
      shouldShowHubPill({
        ...base,
        originTime: old,
        summary: { reports: 1, comments: 0 },
      }),
    ).toBe(true);
    expect(
      shouldShowHubPill({
        ...base,
        originTime: old,
        summary: { reports: 0, comments: 2 },
      }),
    ).toBe(true);
    expect(
      shouldShowHubPill({
        ...base,
        originTime: old,
        summary: { reports: 0, comments: 0 },
      }),
    ).toBe(false);
    expect(shouldShowHubPill({ ...base, originTime: old, summary: null })).toBe(false);
  });
});

describe("featured hubs", () => {
  it("are always open for a regional event, however old and quiet", () => {
    const old = Date.parse("2017-11-12T18:18:17Z");
    expect(
      shouldShowHubPill({
        isRegional: true,
        originTime: old,
        nowMs: Date.parse("2026-10-04T12:00:00Z"),
        summary: { reports: 0, comments: 0, featured: true },
      }),
    ).toBe(true);
  });
});
