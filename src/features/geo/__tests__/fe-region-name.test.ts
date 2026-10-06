import { FE_REGION_TRANSLATIONS } from "../data/fe-region-translations";
import { flinnEngdahlRegionName } from "../fe-region-name";
import { flinnEngdahlNameEn } from "../fe-region";

const ARABIC_SCRIPT = /[؀-ۿ]/u;
const LATIN = /[A-Za-z]/u;

describe("flinnEngdahlRegionName", () => {
  it("names a far-field epicentre in English from the F-E table", () => {
    // 55 km ESE of Kokopo, Papua New Guinea: the USGS sentence the owner
    // complained about. The F-E region is the same for every provider.
    expect(flinnEngdahlRegionName(-4.35, 152.27, "en")).toBe(
      "New Britain region, Papua New Guinea",
    );
  });

  it("translates the region for Sorani, Kurmanji and Arabic", () => {
    expect(flinnEngdahlRegionName(-4.35, 152.27, "ckb")).toBe(
      "ناوچەی بریتانیای نوێ، پاپوا گینیای نوێ",
    );
    expect(flinnEngdahlRegionName(-4.35, 152.27, "kmr")).toBe(
      "Herêma Brîtanyaya Nû, Papua Gîneya Nû",
    );
    expect(flinnEngdahlRegionName(-4.35, 152.27, "ar")).toBe(
      "منطقة بريطانيا الجديدة، بابوا غينيا الجديدة",
    );
  });

  it("uses the translation, not the English text, for Turkey", () => {
    expect(flinnEngdahlRegionName(39, 35, "en")).toBe("Turkey");
    expect(flinnEngdahlRegionName(39, 35, "ckb")).toBe("تورکیا");
    expect(flinnEngdahlRegionName(39, 35, "kmr")).toBe("Tirkiye");
    expect(flinnEngdahlRegionName(39, 35, "ar")).toBe("تركيا");
  });

  it("falls back to the English F-E name for a region without a translation, isolated in RTL locales", () => {
    // Gulf of Thailand (F-E 708) is deliberately not in the table.
    expect(FE_REGION_TRANSLATIONS[708]).toBeUndefined();
    expect(flinnEngdahlRegionName(10, 100, "en")).toBe("Gulf of Thailand");
    expect(flinnEngdahlRegionName(10, 100, "kmr")).toBe("Gulf of Thailand");
    expect(flinnEngdahlRegionName(10, 100, "ckb")).toBe("⁦Gulf of Thailand⁩");
    expect(flinnEngdahlRegionName(10, 100, "ar")).toBe("⁦Gulf of Thailand⁩");
  });

  it("falls back to English for a locale it has no table for", () => {
    expect(flinnEngdahlRegionName(39, 35, "de")).toBe("Turkey");
  });

  it("returns null for a coordinate that is not on the globe", () => {
    expect(flinnEngdahlRegionName(Number.NaN, 0, "en")).toBeNull();
    expect(flinnEngdahlRegionName(95, 0, "ckb")).toBeNull();
  });
});

describe("FE_REGION_TRANSLATIONS", () => {
  const entries = Object.entries(FE_REGION_TRANSLATIONS).map(
    ([key, value]) => [Number(key), value] as const,
  );

  it("is keyed by valid F-E region numbers and is substantial", () => {
    expect(entries.length).toBeGreaterThanOrEqual(400);
    for (const [number] of entries) {
      expect(flinnEngdahlNameEn(number)).not.toBeNull();
    }
  });

  it("covers the Kurdistan / Iraq / Iran / Turkey / Caucasus / Middle East regions", () => {
    const required = [
      337, // Eastern Caucasus
      338, // Caspian Sea
      343, // Turkey-Iran border region
      344, // Armenia-Azerbaijan-Iran border region
      345, // Northwestern Iran
      346, // Iran-Iraq border region
      347, // Western Iran
      348, // Northern and central Iran
      351, // Eastern Arabian Peninsula
      352, // Persian Gulf
      353, // Southern Iran
      355, // Gulf of Oman
      362, // Northwestern Caucasus
      366, // Turkey
      367, // Georgia-Armenia-Turkey border region
      372, // Cyprus region
      373, // Dead Sea region
      374, // Jordan-Syria region
      375, // Iraq
      554, // Red Sea
      555, // Western Arabian Peninsula
    ];
    for (const number of required) {
      expect(FE_REGION_TRANSLATIONS[number]).toBeDefined();
    }
  });

  it("covers the most frequent global M4.5+ regions (Japan, Indonesia, PNG, Chile, Fiji, Tonga, Philippines, Alaska)", () => {
    const frequent = [
      153, 181, 186, 173, 259, 177, 193, 171, 189, 192, 280, 228, 211, 216, 221, 135, 123,
      706, 274, 244, 7, 2, 366,
    ];
    for (const number of frequent) {
      expect(FE_REGION_TRANSLATIONS[number]).toBeDefined();
    }
  });

  it("keeps every name in its own script, so nothing is a stray English fragment", () => {
    for (const [number, tr] of entries) {
      expect([number, tr.ckb]).toEqual([number, expect.stringMatching(ARABIC_SCRIPT)]);
      expect([number, tr.ar]).toEqual([number, expect.stringMatching(ARABIC_SCRIPT)]);
      expect(LATIN.test(tr.ckb)).toBe(false);
      expect(LATIN.test(tr.ar)).toBe(false);
      expect(ARABIC_SCRIPT.test(tr.kmr)).toBe(false);
      expect(tr.kmr.trim()).toBe(tr.kmr);
      expect(tr.kmr.length).toBeGreaterThan(1);
    }
  });

  it("names the Gulf in Arabic as الخليج العربي (owner, 2026-10-06)", () => {
    expect(FE_REGION_TRANSLATIONS[352]?.ar).toBe("الخليج العربي");
  });
});
