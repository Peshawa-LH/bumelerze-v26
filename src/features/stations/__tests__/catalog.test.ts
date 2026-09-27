import ar from "../../../i18n/locales/ar.json";
import ckb from "../../../i18n/locales/ckb.json";
import en from "../../../i18n/locales/en.json";
import kmr from "../../../i18n/locales/kmr.json";
import { listLiveStations } from "../catalog";

describe("live station catalogue", () => {
  it("carries every Iraqi Seismic Observatory station, credits, and a supported service", () => {
    const stations = listLiveStations();
    expect(stations.length).toBeGreaterThanOrEqual(20);
    expect(stations.filter((s) => s.net === "MP").length).toBe(13);
    for (const s of stations) {
      expect(["earthscope", "koeri", "geofon"]).toContain(s.service);
      expect(s.credit.length).toBeGreaterThan(0);
      expect(["HHZ", "BHZ"]).toContain(s.channel);
    }
    expect(new Set(stations.map((s) => s.id)).size).toBe(stations.length);
  });

  it("has every station string in the four locales", () => {
    for (const locale of [en, ckb, kmr, ar] as {
      stations: Record<string, unknown>;
      sensor: Record<string, unknown>;
    }[]) {
      for (const key of [
        "title",
        "intro",
        "lastSample",
        "noData",
        "loading",
        "error",
        "credit",
        "listTitle",
      ]) {
        expect(typeof locale.stations[key]).toBe("string");
      }
      expect(typeof locale.sensor.stationsButton).toBe("string");
    }
  });
});
