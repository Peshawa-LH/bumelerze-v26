import { formatMagnitude, getRelativeTime, isolateNumeric } from "../format";

describe("getRelativeTime", () => {
  const now = 1_700_000_000_000;

  it("clamps a future/negative-age origin time to 'just now' instead of a negative duration", () => {
    // "Rasathane bug lesson" (wave brief) — a client clock a few seconds
    // behind the event's origin time (or a just-published event) must
    // never render as negative/future.
    const future = now + 5_000;
    expect(getRelativeTime(future, now)).toEqual({ unit: "justNow", value: 0 });
  });

  it("reports 'just now' for anything under one minute old", () => {
    expect(getRelativeTime(now - 30_000, now)).toEqual({ unit: "justNow", value: 0 });
    expect(getRelativeTime(now, now)).toEqual({ unit: "justNow", value: 0 });
  });

  it("reports whole minutes once at least one minute has elapsed", () => {
    expect(getRelativeTime(now - 60_000, now)).toEqual({ unit: "minutes", value: 1 });
    expect(getRelativeTime(now - 45 * 60_000, now)).toEqual({
      unit: "minutes",
      value: 45,
    });
  });

  it("switches to hours at the 60-minute boundary", () => {
    expect(getRelativeTime(now - 60 * 60_000, now)).toEqual({ unit: "hours", value: 1 });
    expect(getRelativeTime(now - 5 * 60 * 60_000, now)).toEqual({
      unit: "hours",
      value: 5,
    });
  });

  it("switches to days at the 24-hour boundary", () => {
    expect(getRelativeTime(now - 24 * 60 * 60_000, now)).toEqual({
      unit: "days",
      value: 1,
    });
    expect(getRelativeTime(now - 10 * 24 * 60 * 60_000, now)).toEqual({
      unit: "days",
      value: 10,
    });
  });
});

describe("formatMagnitude", () => {
  it("renders one decimal place with the 'M' prefix (USGS convention)", () => {
    expect(formatMagnitude({ value: 4.6, type: "mb" })).toBe("M 4.6");
    expect(formatMagnitude({ value: 5, type: "mww" })).toBe("M 5.0");
    expect(formatMagnitude({ value: 3.98, type: "ml" })).toBe("M 4.0");
  });
});

describe("isolateNumeric", () => {
  it("wraps the text in a left-to-right isolate pair", () => {
    const wrapped = isolateNumeric("120.0 km");
    expect(wrapped.startsWith("⁦")).toBe(true);
    expect(wrapped.endsWith("⁩")).toBe(true);
    expect(wrapped).toContain("120.0 km");
  });
});
