import { magnitudeTone } from "@/features/events/magnitude-tone";
import i18n from "@/i18n";
import { parseIntensityContours } from "@/features/shakemap/contours";
import { lightColors } from "@/theme/semantic";

import { SULAIMANI_EVENT, URMIA_CONTOURS, URMIA_EVENT } from "../__fixtures__/events";
import {
  buildCardModel,
  bandsTouchGrid,
  computeCardBounds,
  findGridBox,
  selectCardBands,
  type CardInput,
  type CardModel,
} from "../card-layout";
import { buildCardStrings } from "../card-strings";
import { SHARE_IMAGE_HEIGHTS, SHARE_IMAGE_WIDTH } from "../config";
import type { ShareCardSize } from "../types";

const EPICENTER = { lat: 38.2751, lon: 45.1871 };

async function input(
  overrides: Partial<CardInput> & {
    locale?: string;
    size?: ShareCardSize;
    withMap?: boolean;
    reviewStatus?: "automatic" | "reviewed";
  } = {},
): Promise<CardInput> {
  const locale = overrides.locale ?? "en";
  await i18n.changeLanguage(locale);
  const withMap = overrides.withMap ?? true;
  const event = withMap ? URMIA_EVENT : SULAIMANI_EVENT;
  return {
    size: overrides.size ?? "square",
    locale,
    strings: buildCardStrings({
      event,
      locale,
      t: i18n.t,
      agencies: ["GFZ", "US"],
      reviewStatus: withMap ? (overrides.reviewStatus ?? "automatic") : null,
    }),
    magnitudeValue: event.magnitude.value,
    epicenter: withMap ? EPICENTER : { lat: event.lat, lon: event.lon },
    contours: withMap ? URMIA_CONTOURS : null,
    url: "https://bumelerze.com/app/event/bml202602ia",
    colors: lightColors,
    magnitudeBandColor: lightColors.magnitudeBand[magnitudeTone(event.magnitude.value)],
    ...overrides,
  };
}

const textOf = (model: CardModel) => model.texts.map((item) => item.text);

describe("buildCardModel: formats", () => {
  afterAll(() => i18n.changeLanguage("en"));

  it("the square is 1080x1080 and the story 1080x1920", async () => {
    const square = buildCardModel(await input({ size: "square" }));
    const story = buildCardModel(await input({ size: "story" }));
    expect([square.width, square.height]).toEqual([SHARE_IMAGE_WIDTH, 1080]);
    expect([story.width, story.height]).toEqual([SHARE_IMAGE_WIDTH, 1920]);
    expect(SHARE_IMAGE_HEIGHTS).toEqual({ square: 1080, story: 1920 });
  });

  it("only the story carries the QR code and the 'did you feel it' line", async () => {
    const square = buildCardModel(await input({ size: "square" }));
    const story = buildCardModel(await input({ size: "story" }));
    expect(square.qr).toBeNull();
    expect(textOf(square)).not.toContain("Did you feel it? Report in Bumelerze");
    expect(story.qr).not.toBeNull();
    expect(story.qr?.path.startsWith("M")).toBe(true);
    expect(textOf(story).join(" ")).toContain("Did you feel it?");
  });

  it("keeps every block inside the card, with the footer last", async () => {
    for (const size of ["square", "story"] as const) {
      const model = buildCardModel(await input({ size }));
      const footer = model.underlay[model.underlay.length - (size === "story" ? 2 : 1)]!;
      expect(footer.y + footer.height).toBe(model.height);
      expect(model.map.frame.y + model.map.frame.height).toBeLessThan(footer.y);
      for (const chip of model.legendChips) {
        expect(chip.rect.x).toBeGreaterThanOrEqual(0);
        expect(chip.rect.x + chip.rect.width).toBeLessThanOrEqual(model.width);
      }
    }
  });

  it("the story keeps clear of the strips apps cover at the top and bottom", async () => {
    const story = buildCardModel(await input({ size: "story" }));
    const hero = story.texts[0]!;
    expect(hero.y - hero.size).toBeGreaterThanOrEqual(150);
    const footerTexts = story.texts.filter((item) => item.text === "bumelerze.com");
    expect(footerTexts[0]!.y).toBeLessThan(1920 - 170);
  });
});

describe("buildCardModel: content", () => {
  afterAll(() => i18n.changeLanguage("en"));

  it("shows the magnitude, our place line, the local time and the footer", async () => {
    const model = buildCardModel(await input());
    const all = textOf(model);
    expect(all).toContain("M 3.2");
    expect(all).toContain("81 km N of Urmia, Iran".replace("81 km", "⁦81 km⁩"));
    expect(all.some((text) => /Oct 5, 2026/.test(text))).toBe(true);
    expect(all).toContain("bumelerze.com");
    expect(all).toContain("Event data: GEOFON, USGS · SHAKEmap: Bumelerze");
    expect(all).toContain("Intensity (IMS-25)");
  });

  it("the footer carries the single-colour mark, white on the brand colour", async () => {
    const model = buildCardModel(await input());
    expect(model.mark.fill).toBe("#FFFFFF");
    const band = model.underlay[model.underlay.length - 1]!;
    expect(band.fill).toBe(lightColors.brand.primary);
  });

  it("the magnitude stripe uses the magnitude-band colour, not an intensity colour", async () => {
    const model = buildCardModel(await input());
    expect(model.underlay[0]!.fill).toBe(lightColors.magnitudeBand.minor);
  });

  it("splits the magnitude around the number so the unit word can be set small", async () => {
    const english = buildCardModel(await input({ locale: "en" })).texts[0]!;
    expect(english.runs?.map((run) => run.text)).toEqual(["M ", "3.2"]);
    // A lone "M" belongs to the number: same size.
    expect(english.runs?.[0]?.size).toBe(english.runs?.[1]?.size);

    const sorani = buildCardModel(await input({ locale: "ckb" })).texts[0]!;
    expect(sorani.runs?.map((run) => run.text)).toEqual(["٣.٢", " پلە"]);
    expect(sorani.runs![1]!.size).toBeLessThan(sorani.runs![0]!.size / 2);
  });

  it("shows the automatic-estimate note only for an automatic product", async () => {
    const automatic = buildCardModel(await input({ reviewStatus: "automatic" }));
    const reviewed = buildCardModel(await input({ reviewStatus: "reviewed" }));
    expect(textOf(automatic)).toContain("Automatic estimate");
    expect(
      automatic.overlay.some((rect) => rect.stroke?.color === lightColors.status.warning),
    ).toBe(true);
    expect(textOf(reviewed)).not.toContain("Automatic estimate");
  });
});

describe("buildCardModel: the intensity legend", () => {
  afterAll(() => i18n.changeLanguage("en"));

  it("paints one band per rounded level from III up, and the legend matches them", async () => {
    const model = buildCardModel(await input());
    // The fixture has bands at 2.0 (the grid), 2.5, 3.0, 3.5, 4.0, 4.5.
    expect(model.map.bands.map((band) => band.level)).toEqual([3, 4, 5]);
    expect(model.legendChips.map((chip) => chip.level)).toEqual([3, 4, 5]);
    for (const chip of model.legendChips) {
      expect(chip.rect.fill).toBe(lightColors.intensity[chip.level]);
    }
  });

  it("English and Kurmanji read Roman numerals", async () => {
    for (const locale of ["en", "kmr"]) {
      const model = buildCardModel(await input({ locale }));
      expect(model.legendChips.map((chip) => chip.label.text)).toEqual([
        "III",
        "IV",
        "V",
      ]);
    }
  });

  it("Sorani and Arabic read Eastern Arabic digits, never Roman numerals", async () => {
    for (const locale of ["ckb", "ar"]) {
      const model = buildCardModel(await input({ locale }));
      expect(model.legendChips.map((chip) => chip.label.text)).toEqual(["٣", "٤", "٥"]);
      expect(model.legendChips.every((chip) => !/[IVX]/.test(chip.label.text))).toBe(
        true,
      );
    }
  });

  it("the scale reads left to right in every language", async () => {
    for (const locale of ["en", "ckb"]) {
      const model = buildCardModel(await input({ locale }));
      const xs = model.legendChips.map((chip) => chip.rect.x);
      expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    }
  });
});

describe("buildCardModel: right-to-left", () => {
  afterAll(() => i18n.changeLanguage("en"));

  it("anchors reading-start text at the right edge, and left-to-right text at the left", async () => {
    const ltr = buildCardModel(await input({ locale: "en" }));
    const rtl = buildCardModel(await input({ locale: "ckb" }));
    const place = (model: CardModel) => model.texts.find((item) => item.size === 44)!;
    expect(place(ltr).anchor).toBe("start");
    expect(place(ltr).x).toBe(56);
    expect(place(rtl).anchor).toBe("end");
    expect(place(rtl).x).toBe(SHARE_IMAGE_WIDTH - 56);
    expect(rtl.rtl).toBe(true);
    expect(ltr.rtl).toBe(false);
  });

  it("flags text as right-to-left, except the domain, which is always left to right", async () => {
    const model = buildCardModel(await input({ locale: "ckb" }));
    const site = model.texts.find((item) => item.text === "bumelerze.com")!;
    expect(site.rtl).toBe(false);
    const place = model.texts.find((item) => item.size === 44)!;
    expect(place.rtl).toBe(true);
  });

  it("mirrors the accent stripe, the mark and the QR tile; the map itself does not mirror", async () => {
    const ltr = buildCardModel(await input({ locale: "en", size: "story" }));
    const rtl = buildCardModel(await input({ locale: "ar", size: "story" }));
    expect(ltr.underlay[0]!.x).toBe(56);
    expect(rtl.underlay[0]!.x + rtl.underlay[0]!.width).toBe(SHARE_IMAGE_WIDTH - 56);
    expect(ltr.mark.x).toBeLessThan(SHARE_IMAGE_WIDTH / 2);
    expect(rtl.mark.x).toBeGreaterThan(SHARE_IMAGE_WIDTH / 2);
    expect(ltr.qr!.tile.x).toBeGreaterThan(SHARE_IMAGE_WIDTH / 2);
    expect(rtl.qr!.tile.x).toBeLessThan(SHARE_IMAGE_WIDTH / 2);
    // Geography keeps its compass orientation: the same place at the centre.
    const centerLon = (model: CardModel) =>
      (model.map.bounds.minLon + model.map.bounds.maxLon) / 2;
    expect(centerLon(rtl)).toBeCloseTo(centerLon(ltr), 6);
  });

  it("names the towns in the card's own language", async () => {
    const english = buildCardModel(await input({ locale: "en" }));
    const sorani = buildCardModel(await input({ locale: "ckb" }));
    expect(english.map.labels.map((label) => label.text)).toContain("Urmia");
    expect(sorani.map.labels.map((label) => label.text)).toContain("ورمێ");
  });
});

describe("buildCardModel: an event without a shakemap", () => {
  afterAll(() => i18n.changeLanguage("en"));

  it("is an epicentre-and-towns card: no bands, legend, estimate note or SHAKEmap credit", async () => {
    const model = buildCardModel(await input({ withMap: false }));
    expect(model.map.bands).toEqual([]);
    expect(model.legendChips).toEqual([]);
    expect(textOf(model)).not.toContain("Automatic estimate");
    expect(textOf(model)).not.toContain("Intensity (IMS-25)");
    // The credit does not claim a SHAKEmap.
    expect(textOf(model).some((text) => text.includes("SHAKEmap"))).toBe(false);
    expect(textOf(model)).toContain("Event data: GEOFON, USGS");
    expect(model.map.star.points.split(" ")).toHaveLength(10);
    expect(model.map.labels.length).toBeGreaterThan(0);
  });

  it("gets distance rings round the epicentre instead, labelled in the card's numerals", async () => {
    const english = buildCardModel(await input({ withMap: false }));
    expect(english.map.rings.length).toBeGreaterThan(0);
    expect(english.map.labels.some((label) => /^\d+ km$/.test(label.text))).toBe(true);
    const sorani = buildCardModel(await input({ withMap: false, locale: "ckb" }));
    expect(sorani.map.labels.some((label) => /^[٠-٩]+ کم$/.test(label.text))).toBe(true);
  });

  it("keeps the map taller by using the space the legend would take", async () => {
    const withMap = buildCardModel(await input());
    const without = buildCardModel(await input({ withMap: false }));
    expect(without.map.frame.height).toBeGreaterThan(withMap.map.frame.height);
  });
});

describe("the map window", () => {
  afterAll(() => i18n.changeLanguage("en"));

  it("always matches the frame's aspect, so nothing is letterboxed", async () => {
    const model = buildCardModel(await input());
    const { bounds, frame } = model.map;
    const mid = (bounds.minLat + bounds.maxLat) / 2;
    const ground =
      ((bounds.maxLon - bounds.minLon) * Math.cos((mid * Math.PI) / 180)) /
      (bounds.maxLat - bounds.minLat);
    expect(ground).toBeCloseTo(frame.width / frame.height, 3);
  });

  it("never zooms in tighter than about a degree of latitude", () => {
    const bounds = computeCardBounds([], EPICENTER, [], { width: 968, height: 472 });
    expect(bounds.maxLat - bounds.minLat).toBeGreaterThanOrEqual(0.9);
  });

  it("keeps the epicentre and the nearest town in frame", async () => {
    const model = buildCardModel(await input());
    const { bounds } = model.map;
    expect(EPICENTER.lat).toBeGreaterThan(bounds.minLat);
    expect(EPICENTER.lat).toBeLessThan(bounds.maxLat);
    // Urmia (the nearest town) is 81 km south.
    expect(37.55).toBeGreaterThan(bounds.minLat);
    expect(model.map.labels.map((label) => label.text)).toContain("Urmia");
  });

  it("keeps every label inside the frame", async () => {
    for (const locale of ["en", "ckb"]) {
      const model = buildCardModel(await input({ locale }));
      const { frame } = model.map;
      for (const label of model.map.labels) {
        expect(label.x).toBeGreaterThan(frame.x);
        expect(label.x).toBeLessThan(frame.x + frame.width);
        expect(label.y).toBeGreaterThan(frame.y);
        expect(label.y).toBeLessThan(frame.y + frame.height);
      }
    }
  });
});

describe("contour handling", () => {
  it("finds the model grid in the lowest band, and only when it is a rectangle", () => {
    const box = findGridBox(URMIA_CONTOURS)!;
    expect(box.minLon).toBeCloseTo(44.043, 2);
    expect(box.maxLon).toBeCloseTo(46.331, 2);
    expect(box.minLat).toBeCloseTo(37.377, 2);
    expect(box.maxLat).toBeCloseTo(39.173, 2);
    const noGrid = parseIntensityContours({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { value: 3 },
          geometry: {
            type: "MultiPolygon",
            coordinates: [
              [
                [
                  [44, 36],
                  [45, 36],
                  [45.5, 37],
                  [44.5, 37.5],
                  [44, 36],
                ],
              ],
            ],
          },
        },
      ],
    });
    expect(findGridBox(noGrid)).toBeNull();
  });

  it("detects a band cut by the grid edge, and a band that is not", () => {
    const grid = findGridBox(URMIA_CONTOURS)!;
    expect(bandsTouchGrid(selectCardBands(URMIA_CONTOURS), grid)).toBe(false);
    // A grid whose edge runs through the widest painted band cuts it.
    const widest = selectCardBands(URMIA_CONTOURS)[0]!;
    const westEdge = Math.min(
      ...widest.rings.flatMap((ring) => ring.points.map(([lon]) => lon)),
    );
    expect(
      bandsTouchGrid(selectCardBands(URMIA_CONTOURS), { ...grid, minLon: westEdge }),
    ).toBe(true);
  });

  it("draws no open (line) contours: they have no interior to fill", () => {
    const lines = parseIntensityContours({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { value: 5 },
          geometry: {
            type: "MultiLineString",
            coordinates: [
              [
                [44, 36],
                [45, 36],
                [45, 37],
              ],
            ],
          },
        },
      ],
    });
    expect(selectCardBands(lines)).toEqual([]);
  });

  it("clamps the window inside the grid when a band is cut by it", () => {
    const grid = { minLon: 44, maxLon: 46, minLat: 36, maxLat: 37.5 };
    const bands = selectCardBands(
      parseIntensityContours({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { value: 3 },
            geometry: {
              type: "MultiPolygon",
              coordinates: [
                [
                  [
                    [44, 36],
                    [46, 36],
                    [46, 37.5],
                    [44, 37.5],
                    [44, 36],
                  ],
                ],
              ],
            },
          },
        ],
      }),
    );
    const bounds = computeCardBounds(
      bands,
      { lat: 36.7, lon: 45 },
      [],
      { width: 968, height: 472 },
      grid,
    );
    expect(bounds.minLon).toBeGreaterThanOrEqual(grid.minLon - 1e-9);
    expect(bounds.maxLon).toBeLessThanOrEqual(grid.maxLon + 1e-9);
    expect(bounds.minLat).toBeGreaterThanOrEqual(grid.minLat - 1e-9);
    expect(bounds.maxLat).toBeLessThanOrEqual(grid.maxLat + 1e-9);
  });
});

describe("performance guards", () => {
  it("keeps the model small: thin paths, a bounded number of labels", async () => {
    const model = buildCardModel(await input());
    const pathBytes = model.map.bands.reduce((sum, band) => sum + band.d.length, 0);
    expect(pathBytes).toBeLessThan(40_000);
    expect(model.map.labels.length).toBeLessThanOrEqual(8);
  });
});
