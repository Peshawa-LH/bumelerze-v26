/**
 * The text a phone shows for each kind of delivery (migration 0062), in the
 * four languages: our own place line (never a provider's), localized digits,
 * the update and summary wording, and the tags that make an update replace
 * the first alert on the device.
 */
import {
  buildMessage,
  direction,
  distanceText,
  fill,
  localizeDigits,
  magnitudeText,
  placeLine,
  topicOf,
  webPayload,
  type AlertItem,
} from "../message";

const WEB = {
  kind: "web" as const,
  endpoint: "https://fcm.googleapis.com/fcm/send/x",
  p256dh: "p",
  auth: "a",
};
const EVENT = {
  id: "bml2026abcd",
  magnitude: 4.6,
  originTime: "2026-10-09T10:00:00Z",
  lat: 36.1,
  lon: 44.2,
  depthKm: 10,
};

function item(over: Partial<AlertItem> = {}): AlertItem {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    kind: "alert",
    locale: "en",
    context: "near_me",
    target: WEB,
    event: EVENT,
    previousMagnitude: null,
    summaryCount: null,
    attempt: 1,
    ...over,
  };
}

describe("helpers", () => {
  it("localizes digits for ckb and ar only", () => {
    expect(localizeDigits("4.6", "ckb")).toBe("٤.٦");
    expect(localizeDigits("4.6", "ar")).toBe("٤.٦");
    expect(localizeDigits("4.6", "kmr")).toBe("4.6");
    expect(localizeDigits("4.6", "en")).toBe("4.6");
  });

  it("fills templates and leaves unknown keys", () => {
    expect(fill("{{a}} and {{b}}", { a: "x" })).toBe("x and {{b}}");
  });

  it("writes magnitudes the app's way", () => {
    expect(magnitudeText(4.56, "en")).toBe("M 4.6");
    expect(magnitudeText(4, "ckb")).toBe("٤.٠ پلە");
    expect(magnitudeText(5.1, "kmr")).toBe("5.1 pîle");
  });

  it("rounds distances like event surfaces (whole km from 10 up)", () => {
    expect(distanceText(9.94, "en")).toBe("⁦9.9 km⁩");
    expect(distanceText(9.96, "en")).toBe("⁦10 km⁩");
    expect(distanceText(142.3, "en")).toBe("⁦142 km⁩");
  });

  it("finds the compass sector from the city toward the point", () => {
    expect(direction(36, 44, 37, 44)).toBe("n");
    expect(direction(36, 44, 35, 45)).toBe("se");
    expect(direction(36, 44, 36, 43)).toBe("w");
  });

  it("builds the place line from the gazetteer, with region", () => {
    expect(placeLine(36.1, 44.2, "en")).toBe("⁦20 km⁩ SE of Hawler, Kurdistan (Iraq)");
    // The Sorani template no longer glues "ەوە" onto the town name (owner
    // decision, 2026-10-14); the vendored strings follow the app catalog.
    expect(placeLine(36.1, 44.2, "ckb")).toBe(
      "⁦٢٠ کم⁩ باشووری ڕۆژهەڵاتی هەولێر، کوردستان (عێراق)",
    );
  });

  it("falls back to coordinates far from every town", () => {
    expect(placeLine(10, 10, "en")).toBe("Near 10.00, 10.00");
  });

  it("keeps topics to the allowed characters and length", () => {
    expect(topicOf("ev-bml2026abcd")).toBe("ev-bml2026abcd");
    expect(topicOf("a.b c/d")).toBe("abcd");
    expect(topicOf("x".repeat(40))).toHaveLength(32);
    expect(topicOf("...")).toBe("bumelerze");
  });
});

describe("buildMessage", () => {
  it("alert: title with magnitude, body is our place line, deep link to the event", () => {
    const m = buildMessage(item());
    expect(m.title).toBe("M 4.6 earthquake");
    expect(m.body).toBe("⁦20 km⁩ SE of Hawler, Kurdistan (Iraq)");
    expect(m.path).toBe("event/bml2026abcd");
    expect(m.tag).toBe("ev-bml2026abcd");
    expect(m.topic).toBe("ev-bml2026abcd");
    expect(m).toMatchObject({ quiet: false, renotify: false, urgency: "high", dir: "ltr" });
  });

  it("alert in every locale, right-to-left for ckb and ar", () => {
    expect(buildMessage(item({ locale: "ckb" }))).toMatchObject({
      title: "بوومەلەرزەیەکی ٤.٦ پلە",
      dir: "rtl",
      lang: "ckb",
    });
    expect(buildMessage(item({ locale: "ar" }))).toMatchObject({
      title: "زلزال بقوة ٤.٦ درجة",
      dir: "rtl",
    });
    expect(buildMessage(item({ locale: "kmr" }))).toMatchObject({
      title: "Erdhejek 4.6 pîle",
      dir: "ltr",
    });
  });

  it("upgrade: same tag (replaces the first alert), alerts again, names the earlier magnitude", () => {
    const m = buildMessage(item({ kind: "upgrade", previousMagnitude: 3.8 }));
    expect(m.title).toBe("Update: M 4.6 earthquake");
    expect(m.body).toBe(
      "⁦20 km⁩ SE of Hawler, Kurdistan (Iraq). Earlier reported as M 3.8.",
    );
    expect(m.tag).toBe("ev-bml2026abcd");
    expect(m.renotify).toBe(true);
  });

  it("summary: quiet, one tag, count and largest", () => {
    const m = buildMessage(item({ kind: "summary", summaryCount: 12, locale: "ckb" }));
    expect(m.quiet).toBe(true);
    expect(m.urgency).toBe("normal");
    expect(m.tag).toBe("bml-summary");
    expect(m.body).toContain("١٢");
    expect(m.body).toContain("٤.٦ پلە");
  });

  it("test: no event needed, opens the notification settings", () => {
    const m = buildMessage(item({ kind: "test", event: null, locale: "ar" }));
    expect(m.title).toBe("تنبيه تجريبي");
    expect(m.path).toBe("notification-settings");
    expect(m.quiet).toBe(false);
  });

  it("ops (migration 0070): a fixed notice for the admins, no event, opens the admin home", () => {
    const m = buildMessage(item({ kind: "ops", event: null, context: null }));
    expect(m.title).toBe("A data source needs attention");
    expect(m.body).toBe(
      "An earthquake feed or the SHAKEmap worker has stopped working. Open Admin to see which one.",
    );
    expect(m.path).toBe("admin");
    expect(m.tag).toBe("bml-ops");
    expect(m.topic).toBe("bml-ops");
    expect(m.renotify).toBe(true);
    expect(m.urgency).toBe("normal");
    expect(m.timeSensitive).toBe(false);
    // even if an event were attached, an ops notice never reads as an earthquake
    expect(buildMessage(item({ kind: "ops" })).title).toBe("A data source needs attention");
  });

  it("ops in every locale, right-to-left for ckb and ar", () => {
    const ckb = buildMessage(item({ kind: "ops", event: null, locale: "ckb" }));
    expect(ckb.dir).toBe("rtl");
    expect(ckb.title).toBe("سەرچاوەیەکی زانیاری پێویستی بە سەرنجە");
    const ar = buildMessage(item({ kind: "ops", event: null, locale: "ar" }));
    expect(ar.dir).toBe("rtl");
    expect(ar.body).toContain("SHAKEmap");
    const kmr = buildMessage(item({ kind: "ops", event: null, locale: "kmr" }));
    expect(kmr.dir).toBe("ltr");
    expect(kmr.title).toBe("Çavkaniyeke daneyan baldariyê dixwaze");
  });

  it("time-sensitive on iOS from magnitude 5.0 (alerts and updates only), never for tests or summaries", () => {
    const strong = { ...EVENT, magnitude: 5.0 };
    expect(buildMessage(item({ event: strong })).timeSensitive).toBe(true);
    expect(buildMessage(item({ event: { ...EVENT, magnitude: 4.9 } })).timeSensitive).toBe(false);
    expect(buildMessage(item({ kind: "upgrade", event: { ...EVENT, magnitude: 5.3 }, previousMagnitude: 4.8 })).timeSensitive).toBe(true);
    expect(buildMessage(item({ kind: "summary", event: strong, summaryCount: 4 })).timeSensitive).toBe(false);
    expect(buildMessage(item({ kind: "test", event: null })).timeSensitive).toBe(false);
  });

  it("the web payload is the same as before for a strong earthquake (no iOS-only field)", () => {
    const strong = buildMessage(item({ event: { ...EVENT, magnitude: 6.1 } }));
    expect(webPayload(strong, 123)).toBe(
      JSON.stringify({
        title: "M 6.1 earthquake",
        body: "⁦20 km⁩ SE of Hawler, Kurdistan (Iraq)",
        tag: "ev-bml2026abcd",
        path: "event/bml2026abcd",
        quiet: false,
        renotify: false,
        lang: "en",
        dir: "ltr",
        ts: 123,
      }),
    );
  });

  it("the service worker payload carries only what it shows", () => {
    const payload = JSON.parse(webPayload(buildMessage(item()), 123));
    expect(Object.keys(payload).sort()).toEqual(
      ["body", "dir", "lang", "path", "quiet", "renotify", "tag", "title", "ts"].sort(),
    );
    expect(payload.ts).toBe(123);
    expect(new TextEncoder().encode(JSON.stringify(payload)).length).toBeLessThan(3000);
  });
});
