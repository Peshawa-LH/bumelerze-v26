import i18n from "@/i18n";

import { URMIA_EVENT } from "../__fixtures__/events";
import { buildCardStrings, creditSources, splitMagnitudeDisplay } from "../card-strings";

describe("splitMagnitudeDisplay", () => {
  afterAll(() => i18n.changeLanguage("en"));

  it("splits the app's own magnitude template around the number in every locale", async () => {
    const cases: [string, string, string][] = [
      ["en", "M ", ""],
      ["kmr", "", " pîle"],
      ["ckb", "", " پلە"],
      ["ar", "", " درجة"],
    ];
    for (const [locale, prefix, suffix] of cases) {
      await i18n.changeLanguage(locale);
      const split = splitMagnitudeDisplay(
        (value) => i18n.t("events.magnitudeDisplay", { value }),
        "7",
      );
      expect(split).toEqual({ prefix, value: "7", suffix });
    }
  });
});

describe("creditSources", () => {
  const t = i18n.t;
  it("names the registry's authoring agencies once each, as labels", () => {
    expect(creditSources(["US", "GFZ", "NEIC"], "usgs", t)).toBe("USGS, GEOFON");
  });

  it("names at most three", () => {
    expect(creditSources(["US", "GFZ", "EMSC", "ISC"], "usgs", t)).toBe(
      "USGS, GEOFON, EMSC",
    );
  });

  it("falls back to the feed the event came from", async () => {
    await i18n.changeLanguage("en");
    expect(creditSources(undefined, "geofon", i18n.t)).toBe("GEOFON");
    expect(creditSources([], "emsc", i18n.t)).toBe("EMSC");
  });
});

describe("buildCardStrings", () => {
  afterAll(() => i18n.changeLanguage("en"));

  it("resolves everything the card shows in the reader's language", async () => {
    await i18n.changeLanguage("ckb");
    const strings = buildCardStrings({
      event: URMIA_EVENT,
      locale: "ckb",
      t: i18n.t,
      agencies: ["GFZ"],
      reviewStatus: "automatic",
    });
    expect(strings.magnitude.value).toBe("٣.٢");
    expect(strings.legendCaption).toBe("توندی (IMS-25)");
    expect(strings.automaticNote).toBe("خەمڵاندنی ئۆتۆماتیکی");
    expect(strings.kmUnit).toBe("کم");
    expect(strings.credit).toContain("GEOFON");
    expect(strings.siteText).toBe("bumelerze.com");
  });

  it("says nothing about an estimate for a reviewed product, and credits no SHAKEmap without one", async () => {
    await i18n.changeLanguage("en");
    const reviewed = buildCardStrings({
      event: URMIA_EVENT,
      locale: "en",
      t: i18n.t,
      reviewStatus: "reviewed",
    });
    expect(reviewed.automaticNote).toBeNull();
    expect(reviewed.credit).toContain("SHAKEmap");
    const none = buildCardStrings({
      event: URMIA_EVENT,
      locale: "en",
      t: i18n.t,
      reviewStatus: null,
    });
    expect(none.credit).not.toContain("SHAKEmap");
  });
});
