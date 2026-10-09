/**
 * The send-alerts function carries copies of the app's gazetteer and of the
 * strings a push uses (Deno cannot import the app). These must match the app
 * exactly, or a push would name a place differently from the event screen it
 * opens. Fix a failure with: node scripts/generate-send-alerts-data.mjs
 */
import ar from "@/i18n/locales/ar.json";
import ckb from "@/i18n/locales/ckb.json";
import en from "@/i18n/locales/en.json";
import kmr from "@/i18n/locales/kmr.json";
import { GAZETTEER_CITIES } from "@/features/geo/gazetteer";

import { CITIES } from "../gazetteer-data";
import { STRINGS } from "../strings";

const LOCALES = { en, ckb, kmr, ar } as const;

const KEYS: [string, string][] = [
  ["magnitude", "events.magnitudeDisplay"],
  ["alertTitle", "notificationSettings.rehearsal.exampleTitle"],
  ["placeTemplate", "geo.placeLine.template"],
  ["placeWithRegion", "geo.placeLine.withRegion"],
  ["placeCoordinates", "geo.placeLine.coordinates"],
  ["km", "units.km"],
  ["dir_n", "geo.directions.n"],
  ["dir_ne", "geo.directions.ne"],
  ["dir_e", "geo.directions.e"],
  ["dir_se", "geo.directions.se"],
  ["dir_s", "geo.directions.s"],
  ["dir_sw", "geo.directions.sw"],
  ["dir_w", "geo.directions.w"],
  ["dir_nw", "geo.directions.nw"],
  ["region_kurdistanIraq", "geo.regions.kurdistanIraq"],
  ["region_iraq", "geo.regions.iraq"],
  ["region_iran", "geo.regions.iran"],
  ["region_turkey", "geo.regions.turkey"],
  ["region_syria", "geo.regions.syria"],
  ["updateTitle", "alerts.push.updateTitle"],
  ["updateBody", "alerts.push.updateBody"],
  ["summaryTitle", "alerts.push.summaryTitle"],
  ["summaryBody", "alerts.push.summaryBody"],
  ["testTitle", "alerts.push.testTitle"],
  ["testBody", "alerts.push.testBody"],
];

function pick(obj: unknown, dotted: string): unknown {
  return dotted
    .split(".")
    .reduce<unknown>((value, part) => (value as Record<string, unknown> | undefined)?.[part], obj);
}

describe("send-alerts vendored data", () => {
  it.each(Object.keys(LOCALES))("%s strings match the app", (locale) => {
    const expected = Object.fromEntries(
      KEYS.map(([key, path]) => [key, pick(LOCALES[locale as keyof typeof LOCALES], path)]),
    );
    expect(STRINGS[locale as keyof typeof STRINGS]).toEqual(expected);
  });

  it("the gazetteer matches the app", () => {
    expect(CITIES).toEqual(
      GAZETTEER_CITIES.map((city) => ({
        id: city.id,
        names: city.names,
        lat: city.lat,
        lon: city.lon,
        country: city.country,
        inKurdistanRegion: city.inKurdistanRegion,
      })),
    );
  });
});
