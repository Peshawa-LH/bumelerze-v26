// Pure: turns one planned delivery into the localized text a phone shows.
// No Deno, no network; Jest drives it directly (__tests__/message.test.ts).
//
// The place line is OURS (D28): "{distance} {direction} of {city}, {region}"
// from the same gazetteer and the same strings the app uses (both vendored,
// see gazetteer-data.ts / strings.ts and their sync test), never a provider's
// place text. Digits follow the app: Eastern Arabic-Indic for ckb and ar.

import { CITIES, type AlertCity } from "./gazetteer-data.ts";
import { STRINGS, type AlertLocale } from "./strings.ts";

export type DeliveryKind = "alert" | "upgrade" | "summary" | "test";

export interface AlertEvent {
  /** Bumelerze id ("bml2026abcd"): the app route is /event/<id>. */
  id: string;
  magnitude: number;
  originTime: string;
  lat: number;
  lon: number;
  depthKm: number | null;
}

export interface WebTarget {
  kind: "web";
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface ExpoTarget {
  kind: "expo";
  token: string;
}

export interface AlertItem {
  id: string;
  kind: DeliveryKind;
  locale: AlertLocale;
  context: "near_me" | "another_place" | null;
  target: WebTarget | ExpoTarget;
  event: AlertEvent | null;
  previousMagnitude: number | null;
  summaryCount: number | null;
  attempt: number;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Same tag = the newer notification replaces the older one on the device. */
  tag: string;
  /** Web push Topic header: the push service keeps only the newest per topic. */
  topic: string;
  /** App path under the web base (/app): "event/bml2026abcd". */
  path: string;
  /** No sound or vibration (the sequence summary). */
  quiet: boolean;
  /** Alert again even though a notification with this tag is showing. */
  renotify: boolean;
  urgency: "high" | "normal";
  /** How long a push service may hold it for an offline device. */
  ttlSeconds: number;
  lang: AlertLocale;
  dir: "rtl" | "ltr";
}

const EASTERN = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
const LRI = "⁦";
const PDI = "⁩";

export function isAlertLocale(value: unknown): value is AlertLocale {
  return value === "en" || value === "ckb" || value === "kmr" || value === "ar";
}

export function localizeDigits(text: string, locale: AlertLocale): string {
  if (locale !== "ckb" && locale !== "ar") {
    return text;
  }
  return text.replace(/[0-9]/g, (digit) => EASTERN[Number(digit)] ?? digit);
}

export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => values[key] ?? match);
}

function s(locale: AlertLocale) {
  return STRINGS[locale];
}

export function magnitudeText(value: number, locale: AlertLocale): string {
  return fill(s(locale).magnitude, { value: localizeDigits(value.toFixed(1), locale) });
}

const EARTH_RADIUS_KM = 6371;
const toRad = (degrees: number) => (degrees * Math.PI) / 180;

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const SECTORS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
type Sector = (typeof SECTORS)[number];

/** Compass sector from the city toward the epicentre (app's bearing8). */
export function direction(fromLat: number, fromLon: number, toLat: number, toLon: number): Sector {
  const phi1 = toRad(fromLat);
  const phi2 = toRad(toLat);
  const dl = toRad(toLon - fromLon);
  const y = Math.sin(dl) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dl);
  const degrees = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return SECTORS[Math.round(degrees / 45) % 8] ?? "n";
}

/** Whole km from 10 km up, one decimal below (the app's event-distance rule). */
export function distanceText(km: number, locale: AlertLocale): string {
  const rounded = Math.round(km * 10) / 10;
  const numeral = localizeDigits(km.toFixed(rounded >= 10 ? 0 : 1), locale);
  return `${LRI}${numeral} ${s(locale).km}${PDI}`;
}

/** Beyond this the app names a Flinn-Engdahl region; alerts fall back to coordinates. */
const NEAREST_CITY_LIMIT_KM = 300;

function regionKey(city: AlertCity): string {
  if (city.inKurdistanRegion) {
    return "region_kurdistanIraq";
  }
  return {
    IQ: "region_iraq",
    IR: "region_iran",
    TR: "region_turkey",
    SY: "region_syria",
  }[city.country];
}

export function placeLine(lat: number, lon: number, locale: AlertLocale): string {
  let best: AlertCity | null = null;
  let bestKm = Infinity;
  for (const city of CITIES) {
    const km = distanceKm(city.lat, city.lon, lat, lon);
    if (km < bestKm) {
      best = city;
      bestKm = km;
    }
  }
  const strings = s(locale) as Record<string, string>;
  if (!best || bestKm > NEAREST_CITY_LIMIT_KM) {
    return fill(strings.placeCoordinates ?? "", {
      lat: localizeDigits(lat.toFixed(2), locale),
      lon: localizeDigits(lon.toFixed(2), locale),
    });
  }
  const line = fill(strings.placeTemplate ?? "", {
    distance: distanceText(bestKm, locale),
    direction: strings[`dir_${direction(best.lat, best.lon, lat, lon)}`] ?? "",
    city: best.names[locale],
  });
  return fill(strings.placeWithRegion ?? "", {
    line,
    region: strings[regionKey(best)] ?? "",
  });
}

/** Only letters, digits, "_" and "-", at most 32: what the Topic header allows. */
export function topicOf(tag: string): string {
  return tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || "bumelerze";
}

export function buildMessage(item: AlertItem): PushMessage {
  const locale = item.locale;
  const str = s(locale);
  const dir = locale === "ckb" || locale === "ar" ? "rtl" : "ltr";
  const base = { lang: locale, dir } as const;

  if (item.kind === "test" || item.event === null) {
    return {
      ...base,
      title: str.testTitle,
      body: str.testBody,
      tag: "bml-test",
      topic: "bml-test",
      path: "notification-settings",
      quiet: false,
      renotify: true,
      urgency: "high",
      ttlSeconds: 600,
    };
  }

  const event = item.event;
  const magnitude = magnitudeText(event.magnitude, locale);
  const place = placeLine(event.lat, event.lon, locale);
  const path = `event/${event.id}`;

  if (item.kind === "summary") {
    return {
      ...base,
      title: str.summaryTitle,
      body: fill(str.summaryBody, {
        count: localizeDigits(String(item.summaryCount ?? 0), locale),
        magnitude,
        place,
      }),
      tag: "bml-summary",
      topic: "bml-summary",
      path,
      quiet: true,
      renotify: false,
      urgency: "normal",
      ttlSeconds: 6 * 3600,
    };
  }

  const title = fill(str.alertTitle, { magnitude });
  const tag = `ev-${event.id}`;
  if (item.kind === "upgrade" && item.previousMagnitude !== null) {
    return {
      ...base,
      title: fill(str.updateTitle, { title }),
      body: fill(str.updateBody, {
        place,
        previous: magnitudeText(item.previousMagnitude, locale),
      }),
      tag,
      topic: topicOf(tag),
      path,
      quiet: false,
      renotify: true,
      urgency: "high",
      ttlSeconds: 1800,
    };
  }
  return {
    ...base,
    title,
    body: place,
    tag,
    topic: topicOf(tag),
    path,
    quiet: false,
    renotify: false,
    urgency: "high",
    ttlSeconds: 1800,
  };
}

/** What the service worker receives (public/push-sw.js reads these names). */
export function webPayload(message: PushMessage, nowMs: number): string {
  return JSON.stringify({
    title: message.title,
    body: message.body,
    tag: message.tag,
    path: message.path,
    quiet: message.quiet,
    renotify: message.renotify,
    lang: message.lang,
    dir: message.dir,
    ts: nowMs,
  });
}
