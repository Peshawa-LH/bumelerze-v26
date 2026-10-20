import i18n from "@/i18n";
import {
  formatAbsoluteDual,
  formatCoordinates,
  formatDateOnly,
  formatDepthKm,
  formatDistanceKm,
  formatEventDistanceKm,
  formatIsolatedDistance,
  formatMagnitudeValue,
  formatRelativeTimeValue,
  getRelativeTime,
  isolateLocalizedTime,
  isolateNumeric,
} from "../format";

describe("getRelativeTime", () => {
  const now = 1_700_000_000_000;

  it("clamps a future/negative-age origin time to 'just now' instead of a negative duration", () => {
    // "Rasathane bug lesson" (brief) — a client clock a few seconds
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

  it("coordinates render three decimals per axis, comma punctuation never localized, the pair isolated as one LTR unit", () => {
    // One isolate around the whole pair (A-7 a): under an RTL paragraph the
    // bidi algorithm otherwise swaps the two numbers around the comma.
    expect(formatCoordinates(35.56, 45.43, "en")).toBe(isolateNumeric("35.560, 45.430"));
    expect(formatCoordinates(35.56, 45.43, "ckb")).toBe(isolateNumeric("٣٥.٥٦٠, ٤٥.٤٣٠"));
  });
});

describe("formatIsolatedDistance", () => {
  it("composes the numeral, a localized unit label, and a bidi isolate", () => {
    const result = formatIsolatedDistance(38.24, "en", "km");
    expect(result).toBe(isolateNumeric("38 km"));
    expect(result).toContain("38 km");
  });

  it("uses the passed-in localized unit label (e.g. Sorani 'کم') and digit-localizes the numeral", () => {
    const result = formatIsolatedDistance(38.24, "ckb", "کم");
    expect(result).toContain("٣٨ کم");
    expect(formatIsolatedDistance(4.26, "ckb", "کم")).toContain("٤.٣ کم");
  });
});

describe("formatEventDistanceKm (one precision rule for every event surface)", () => {
  it("shows one decimal below 10 km and whole kilometres from 10 km up", () => {
    expect(formatEventDistanceKm(0.04, "en")).toBe("0.0");
    expect(formatEventDistanceKm(4.26, "en")).toBe("4.3");
    expect(formatEventDistanceKm(9.94, "en")).toBe("9.9");
    expect(formatEventDistanceKm(10, "en")).toBe("10");
    expect(formatEventDistanceKm(30.7, "en")).toBe("31");
    expect(formatEventDistanceKm(142.4, "en")).toBe("142");
    expect(formatEventDistanceKm(1234.6, "en")).toBe("1235");
  });

  it("tests the threshold on the rounded value, so 9.96 reads 10 and never 10.0", () => {
    expect(formatEventDistanceKm(9.96, "en")).toBe("10");
    expect(formatEventDistanceKm(9.949, "en")).toBe("9.9");
  });

  it("localizes the digits and leaves the engineering formatter at one decimal", () => {
    expect(formatEventDistanceKm(30.7, "ckb")).toBe("٣١");
    expect(formatEventDistanceKm(30.7, "ar")).toBe("٣١");
    expect(formatEventDistanceKm(30.7, "kmr")).toBe("31");
    // The handbook keeps its precise, one-decimal form.
    expect(formatDistanceKm(30.7, "en")).toBe("30.7");
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

    // The UI backlog item 6's exact bug: month name + digits must both be
    // correctly localized and never mixed with the wrong script.
    expect(utc).toBe("Aug 15, 2026, 12:00 PM UTC");
  });

  it("localizes the Sorani month name and every digit — no Latin letters or digits leak in", async () => {
    await i18n.changeLanguage("ckb");
    const { utc, local } = formatAbsoluteDual(originTimeMs, "ckb", i18n.t.bind(i18n));

    expect(utc).toContain("ئاب"); // month 8, Sorani
    expect(utc).toContain("١٥"); // day 15, Eastern Arabic-Indic digits
    expect(utc).toContain("٢٠٢٦"); // year
    expect(utc).toContain("دوای نیوەڕۆ"); // 12:00 UTC is PM → after noon, never "PM" (owner 2026-10-08)
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
    expect(utc).toContain("12:00 piştî nîvro");
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

describe("dates on an engine whose Intl ignores -u-nu-latn (Hermes on iOS)", () => {
  // Hermes on iOS answers `Intl.DateTimeFormat("ckb-u-nu-latn")` in the
  // locale's own digits ("٢٠") and resolves Kurmanji to the phone's
  // language; `Number("٢٠")` is NaN, so every Sorani and Kurmanji event date
  // read "NaN months.short.NaN" on the iOS Simulator (2026-10-20). Node and
  // browsers honour the extension, so this fake reproduces Hermes.
  const RealDateTimeFormat = Intl.DateTimeFormat;
  const originTimeMs = Date.UTC(2026, 9, 20, 14, 5, 0);
  const originalLanguage = i18n.language;
  const easternDigits = (text: string) =>
    text.replace(/[0-9]/g, (digit) => "٠١٢٣٤٥٦٧٨٩"[Number(digit)] ?? digit);

  beforeEach(() => {
    const hermesLike = function (
      locales?: string | string[],
      options?: Intl.DateTimeFormatOptions,
    ) {
      const real = new RealDateTimeFormat(locales, options);
      return {
        resolvedOptions: () => real.resolvedOptions(),
        format: (date?: Date | number) => easternDigits(real.format(date)),
        formatToParts: (date?: Date | number) =>
          real
            .formatToParts(date)
            .map((part) => ({ ...part, value: easternDigits(part.value) })),
      };
    };
    jest
      .spyOn(Intl, "DateTimeFormat")
      .mockImplementation(hermesLike as unknown as typeof Intl.DateTimeFormat);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await i18n.changeLanguage(originalLanguage);
  });

  it.each(["en", "ckb", "kmr", "ar"])(
    "renders a real UTC date and time in %s",
    async (locale) => {
      await i18n.changeLanguage(locale);
      const t = i18n.t.bind(i18n);
      const { utc, local } = formatAbsoluteDual(originTimeMs, locale, t);
      for (const text of [utc, local, formatDateOnly(originTimeMs, locale, t, "UTC")]) {
        expect(text).not.toMatch(/NaN|months\.short|undefined/);
      }
      expect(utc).toContain(t("months.short.10"));
      const digits = (value: string) =>
        locale === "ckb" || locale === "ar" ? easternDigits(value) : value;
      expect(utc).toContain(digits("20"));
      expect(utc).toContain(digits("2026"));
      expect(utc).toContain(digits("2:05"));
      expect(utc).toContain(t("time.pm"));
    },
  );

  it("folds the digits of any other time zone back to numbers", async () => {
    await i18n.changeLanguage("ckb");
    const result = formatDateOnly(originTimeMs, "ckb", i18n.t.bind(i18n), "Asia/Baghdad");
    expect(result).not.toMatch(/NaN|months\.short/);
    expect(result).toContain("٢٠");
    expect(result).toContain(i18n.t("months.short.10"));
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

describe("isolateLocalizedTime", () => {
  it("[regression] wraps a localized date in a first-strong isolate, so a Latin run in a Sorani date stays at its end", () => {
    const sorani = "١٢ی تشرینی دووەمی ٢٠١٧، ٦:١٨ دوای نیوەڕۆ UTC";
    const wrapped = isolateLocalizedTime(sorani);
    // U+2068 FSI: the chunk takes the direction of its first letter (right
    // to left here); inside U+2066 (LRI) "UTC" was drawn before the date.
    expect(wrapped).toBe(`\u2068${sorani}\u2069`);
    expect(wrapped).not.toContain("\u2066");
  });

  it("isolates an English time the same way (its first letter is Latin)", () => {
    expect(isolateLocalizedTime("6:18 PM")).toBe("\u20686:18 PM\u2069");
  });
});
