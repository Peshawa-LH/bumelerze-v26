import ar from "../../../i18n/locales/ar.json";
import ckb from "../../../i18n/locales/ckb.json";
import en from "../../../i18n/locales/en.json";
import kmr from "../../../i18n/locales/kmr.json";
import { findLiveStation, listLiveStations } from "../catalog";

describe("live station catalogue", () => {
  it("carries every Iraqi Seismic Observatory station, credits, and a supported service", () => {
    const stations = listLiveStations();
    expect(stations.length).toBeGreaterThanOrEqual(20);
    expect(stations.filter((s) => s.net === "MP").length).toBe(13);
    for (const s of stations) {
      expect(["earthscope", "koeri", "geofon", "raspberryshake"]).toContain(s.service);
      expect(s.credit.length).toBeGreaterThan(0);
      // A Raspberry Shake's vertical is its EHZ geophone.
      expect(s.service === "raspberryshake" ? ["EHZ"] : ["HHZ", "BHZ"]).toContain(
        s.channel,
      );
    }
    expect(new Set(stations.map((s) => s.id)).size).toBe(stations.length);
  });

  it("carries KESO, the Raspberry Shake in Hawler, as the owner named and credited it", () => {
    const keso = findLiveStation("AM.R079D");
    expect(keso).toEqual({
      id: "AM.R079D",
      net: "AM",
      sta: "R079D",
      loc: "00",
      channel: "EHZ",
      lat: 36.16216,
      lon: 43.9461,
      elevM: 390,
      sps: 100,
      service: "raspberryshake",
      name: "Hawler, TIU",
      distanceKmFromErbil: 7,
      country: "IQ",
      operator:
        "Kurdistan Educational Seismic Observatory, Tishk International University",
      credit: "Kurdistan Educational Seismic Observatory via Raspberry Shake, S.A.",
      host: "tiu",
      lastSeenAt: expect.any(String),
    });
    const stations = listLiveStations();
    // Nearest to Hawler first, so it heads the list.
    expect(stations[0]?.id).toBe("AM.R079D");
    const distances = stations.map((s) => s.distanceKmFromErbil);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    // Only this Raspberry Shake: the data licence asks for no
    // "network"-style page of other people's Shakes.
    expect(
      stations.filter((s) => s.service === "raspberryshake").map((s) => s.id),
    ).toEqual(["AM.R079D"]);
  });

  it("has every station string in the four locales", () => {
    for (const locale of [en, ckb, kmr, ar] as {
      stations: Record<string, unknown>;
      sensor: Record<string, unknown>;
    }[]) {
      for (const key of [
        "intro",
        "lastSample",
        "noData",
        "loading",
        "error",
        "credit",
        "listTitle",
        "noDataLastHour",
      ]) {
        expect(typeof locale.stations[key]).toBe("string");
      }
      // Every host a station names has its line.
      const hostedBy = locale.stations.hostedBy as Record<string, unknown>;
      for (const station of listLiveStations()) {
        if (station.host) expect(typeof hostedBy[station.host]).toBe("string");
      }
      expect(typeof (locale.sensor.mode as Record<string, unknown>).stations).toBe(
        "string",
      );
    }
  });
});
