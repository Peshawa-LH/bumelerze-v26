import i18n from "@/i18n";

import { URMIA_EVENT } from "../__fixtures__/events";
import {
  buildShareCaption,
  buildShareUrl,
  ensureLinkInText,
  isolateUrlForLocale,
} from "../caption";

const URL = "https://bumelerze.com/app/event/bml202602ia";
const LRI = "⁦";
const PDI = "⁩";

async function captionIn(locale: string, shareId = "bml202602ia"): Promise<string> {
  await i18n.changeLanguage(locale);
  return buildShareCaption({
    event: URMIA_EVENT,
    shareId,
    locale,
    t: i18n.t,
  });
}

describe("buildShareUrl", () => {
  it("points at the web app's event route with the id", () => {
    expect(buildShareUrl("bml202602ia")).toBe(URL);
  });

  it("encodes an id that is not url-safe (a provider id is shared as-is)", () => {
    expect(buildShareUrl("a b/c")).toBe("https://bumelerze.com/app/event/a%20b%2Fc");
  });
});

describe("buildShareCaption", () => {
  const originalLanguage = i18n.language;
  afterEach(async () => {
    await i18n.changeLanguage(originalLanguage);
  });

  it("English: magnitude, our place line, local time, the bare link and the hashtag", async () => {
    const caption = await captionIn("en");
    expect(caption).toContain("M3.2 earthquake");
    expect(caption).toContain("81 km N of Urmia, Iran");
    expect(caption).toMatch(/Oct 5, 2026, \d{1,2}:\d{2} (AM|PM)/);
    expect(caption.endsWith(`${URL} #Bumelerze`)).toBe(true);
    // A left-to-right sentence carries the plain URL, no invisible marks.
    expect(caption).not.toContain(LRI);
    expect(caption).not.toContain(PDI);
  });

  it("Kurmanji: Latin script, Latin digits, the bare link", async () => {
    const caption = await captionIn("kmr");
    expect(caption).toContain("Erdhejek bi 3.2 pîle");
    expect(caption).toContain("Urmiye");
    expect(caption.endsWith(`${URL} #Bumelerze`)).toBe(true);
    expect(caption).not.toContain(LRI);
  });

  it("Sorani: Eastern Arabic digits, and the link isolated left-to-right", async () => {
    const caption = await captionIn("ckb");
    expect(caption).toContain("بوومەلەرزەیەکی ٣.٢ پلە");
    expect(caption).toContain("ورمێ");
    // The URL is wrapped as one LTR run so the bidi algorithm cannot reorder it.
    expect(caption).toContain(`${LRI}${URL}${PDI}`);
    expect(caption.endsWith(`${LRI}${URL}${PDI} #Bumelerze`)).toBe(true);
    expect(caption).not.toMatch(/[0-9]\.[0-9] pîle/);
  });

  it("Arabic: Eastern Arabic digits, and the link isolated left-to-right", async () => {
    const caption = await captionIn("ar");
    expect(caption).toContain("زلزال بقوة ٣.٢ درجة");
    expect(caption).toContain(`${LRI}${URL}${PDI}`);
  });

  it("uses the provider id in the link when no Bumelerze id is known yet", async () => {
    const caption = await captionIn("en", "gfz2026tksc");
    expect(caption).toContain("https://bumelerze.com/app/event/gfz2026tksc");
  });

  it("stays one short line", async () => {
    for (const locale of ["en", "kmr", "ckb", "ar"]) {
      const caption = await captionIn(locale);
      expect(caption).not.toContain("\n");
      expect(caption.length).toBeLessThan(220);
    }
  });
});

describe("isolateUrlForLocale", () => {
  it("wraps only for right-to-left locales", () => {
    expect(isolateUrlForLocale(URL, "en")).toBe(URL);
    expect(isolateUrlForLocale(URL, "kmr")).toBe(URL);
    expect(isolateUrlForLocale(URL, "ckb")).toBe(`${LRI}${URL}${PDI}`);
    expect(isolateUrlForLocale(URL, "ar")).toBe(`${LRI}${URL}${PDI}`);
  });
});

describe("ensureLinkInText", () => {
  it("keeps text that already holds the link", () => {
    expect(ensureLinkInText(`  hello ${URL} `, URL)).toBe(`hello ${URL}`);
  });

  it("puts the link back when the user deleted it", () => {
    expect(ensureLinkInText("hello", URL)).toBe(`hello\n${URL}`);
  });

  it("sends just the link when the caption is emptied", () => {
    expect(ensureLinkInText("   ", URL)).toBe(URL);
  });
});
