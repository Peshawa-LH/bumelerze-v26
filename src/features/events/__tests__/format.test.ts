import {
  formatCoordinates,
  formatDepthKm,
  formatDistanceKm,
  formatIsolatedDistance,
  formatMagnitude,
  formatMagnitudeValue,
  formatRelativeTimeValue,
  getRelativeTime,
  isolateNumeric,
} from "../format";

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

describe("formatRelativeTimeValue", () => {
  it("digit-localizes the count for ckb/ar, keeps Latin for en/kmr", () => {
    expect(formatRelativeTimeValue(45, "en")).toBe("45");
    expect(formatRelativeTimeValue(45, "kmr")).toBe("45");
    expect(formatRelativeTimeValue(45, "ckb")).toBe("٤٥");
    expect(formatRelativeTimeValue(45, "ar")).toBe("٤٥");
  });
});

describe("formatMagnitude / formatMagnitudeValue", () => {
  it("renders one decimal place with the 'M' prefix (USGS convention), Latin digits in en", () => {
    expect(formatMagnitude({ value: 4.6, type: "mb" }, "en")).toBe("M 4.6");
    expect(formatMagnitude({ value: 5, type: "mww" }, "en")).toBe("M 5.0");
    expect(formatMagnitude({ value: 3.98, type: "ml" }, "en")).toBe("M 4.0");
  });

  it("digit-localizes the magnitude numeral for ckb and ar (ui-backlog.md wave 5 item 1 — reverses the earlier 'always Latin' design-language.md call)", () => {
    expect(formatMagnitude({ value: 4.6, type: "mb" }, "ckb")).toBe("M ٤.٦");
    expect(formatMagnitude({ value: 4.6, type: "mb" }, "ar")).toBe("M ٤.٦");
  });

  it("keeps Latin digits for kmr", () => {
    expect(formatMagnitude({ value: 4.6, type: "mb" }, "kmr")).toBe("M 4.6");
  });

  it("formatMagnitudeValue omits the 'M' prefix (for the a11y label, which already says 'Magnitude')", () => {
    expect(formatMagnitudeValue(4.6, "en")).toBe("4.6");
    expect(formatMagnitudeValue(4.6, "ckb")).toBe("٤.٦");
  });
});

describe("formatDistanceKm / formatDepthKm / formatCoordinates", () => {
  it("formats a numeral only, one decimal, no unit text", () => {
    expect(formatDistanceKm(38.24, "en")).toBe("38.2");
    expect(formatDistanceKm(38.24, "ckb")).toBe("٣٨.٢");
  });

  it("depth follows the same numeral-only, digit-localized convention", () => {
    expect(formatDepthKm(12.04, "en")).toBe("12.0");
    expect(formatDepthKm(12.04, "ar")).toBe("١٢.٠");
  });

  it("coordinates render three decimals per axis, comma punctuation never localized", () => {
    expect(formatCoordinates(35.56, 45.43, "en")).toBe("35.560, 45.430");
    expect(formatCoordinates(35.56, 45.43, "ckb")).toBe("٣٥.٥٦٠, ٤٥.٤٣٠");
  });
});

describe("formatIsolatedDistance", () => {
  it("composes the numeral, a localized unit label, and a bidi isolate", () => {
    const result = formatIsolatedDistance(38.24, "en", "km");
    expect(result).toBe(isolateNumeric("38.2 km"));
    expect(result).toContain("38.2 km");
  });

  it("uses the passed-in localized unit label (e.g. Sorani 'کم') and digit-localizes the numeral", () => {
    const result = formatIsolatedDistance(38.24, "ckb", "کم");
    expect(result).toContain("٣٨.٢ کم");
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
