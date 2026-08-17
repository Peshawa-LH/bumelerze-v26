import i18n from "@/i18n";
import {
  formatAbsoluteDual,
  formatCoordinates,
  formatDateOnly,
  formatDepthKm,
  formatDistanceKm,
  formatIsolatedDistance,
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

describe("formatMagnitudeValue", () => {
  // The display prefix ("M" / "پلە") is an i18n template
  // (events.magnitudeDisplay), not this module's job — Peshawa's
  // 2026-08-06 correction; see format.ts NOTE. This module only owns the
  // one-decimal, digit-localized numeral.
  it("renders one decimal place, digit-localized per locale", () => {
    expect(formatMagnitudeValue(4.6, "en")).toBe("4.6");
    expect(formatMagnitudeValue(5, "en")).toBe("5.0");
    expect(formatMagnitudeValue(3.98, "en")).toBe("4.0");
    expect(formatMagnitudeValue(4.6, "ckb")).toBe("٤.٦");
    expect(formatMagnitudeValue(4.6, "ar")).toBe("٤.٦");
    expect(formatMagnitudeValue(4.6, "kmr")).toBe("4.6");
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

describe("formatAbsoluteDual", () => {
  // 2026-08-15T12:00:00Z — mid-month, mid-day UTC so every locale's `local`
  // variant lands on the same calendar month regardless of the host
  // machine's timezone (this suite runs with no TZ pinned in jest.config).
  const originTimeMs = Date.UTC(2026, 7, 15, 12, 0, 0);
  const originalLanguage = i18n.language;

  afterEach(async () => {
    await i18n.changeLanguage(originalLanguage);
  });

  it("renders an English month abbreviation via the i18n table, not Intl's own locale data", async () => {
    await i18n.changeLanguage("en");
    const { utc } = formatAbsoluteDual(originTimeMs, "en", i18n.t.bind(i18n));

    // ui-backlog.md item 6's exact bug: month name + digits must both be
    // correctly localized and never mixed with the wrong script.
    expect(utc).toBe("Aug 15, 2026, 12:00 PM UTC");
  });

  it("localizes the Sorani month name and every digit — no Latin letters or digits leak in", async () => {
    await i18n.changeLanguage("ckb");
    const { utc, local } = formatAbsoluteDual(originTimeMs, "ckb", i18n.t.bind(i18n));

    expect(utc).toContain("ئاب"); // month 8, Sorani
    expect(utc).toContain("١٥"); // day 15, Eastern Arabic-Indic digits
    expect(utc).toContain("٢٠٢٦"); // year
    expect(utc).toContain("شەوانە"); // D22: 12:00 UTC is PM → شەوانە, never "PM"
    expect(/[0-9]/.test(utc)).toBe(false); // no stray Latin digits
    // "UTC" itself is a deliberate, un-translated suffix (see format.ts) —
    // strip it before checking the date/time portion is free of stray
    // English month text.
    expect(/[a-zA-Z]/.test(utc.replace(/ UTC$/, ""))).toBe(false);
    // `local` shares the same day/month (mid-month UTC noon, see comment
    // above) regardless of host timezone.
    expect(local).toContain("ئاب");
    expect(/[a-zA-Z]/.test(local)).toBe(false);
  });

  it("localizes the Arabic (Iraq/Levantine) month name", async () => {
    await i18n.changeLanguage("ar");
    const { utc } = formatAbsoluteDual(originTimeMs, "ar", i18n.t.bind(i18n));

    expect(utc).toContain("آب"); // Iraqi/Levantine Arabic for August
    expect(utc).not.toContain("أغسطس"); // NOT the MSA/Gulf "yanayir-style" set
  });

  it("keeps Kurmanji's own month name and Latin digits", async () => {
    await i18n.changeLanguage("kmr");
    const { utc } = formatAbsoluteDual(originTimeMs, "kmr", i18n.t.bind(i18n));

    // D22: the clock is now OUR 12h + i18n period token in every locale
    // (never Intl's dayPeriod — Hermes/ICU has no kmr/ckb data), so kmr
    // pins its own period word too (draft-machine, flagged for review).
    expect(utc).toContain("15 Tebax 2026");
    expect(utc).toContain("12:00 êvar");
    expect(utc.endsWith("UTC")).toBe(true);
  });

  it("appends the UTC suffix only to the utc variant", async () => {
    await i18n.changeLanguage("en");
    const { utc, local } = formatAbsoluteDual(originTimeMs, "en", i18n.t.bind(i18n));

    expect(utc.endsWith("UTC")).toBe(true);
    expect(local.endsWith("UTC")).toBe(false);
  });
});

describe("formatDateOnly", () => {
  const originTimeMs = Date.UTC(2026, 7, 15, 12, 0, 0);
  const originalLanguage = i18n.language;

  afterEach(async () => {
    await i18n.changeLanguage(originalLanguage);
  });

  it("renders day/month/year with no time-of-day component", async () => {
    await i18n.changeLanguage("en");
    const result = formatDateOnly(originTimeMs, "en", i18n.t.bind(i18n));

    expect(result).toBe("Aug 15, 2026");
    expect(result).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it("digit-localizes and orders day-first for Sorani, no stray Latin characters", async () => {
    await i18n.changeLanguage("ckb");
    const result = formatDateOnly(originTimeMs, "ckb", i18n.t.bind(i18n));

    expect(result).toContain("١٥");
    expect(result).toContain("ئاب");
    expect(result).toContain("٢٠٢٦");
    expect(/[0-9a-zA-Z]/.test(result)).toBe(false);
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
