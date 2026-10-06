import catalogJson from "../../../assets/stations/live-stations.json";
import type { LiveStation, LiveStationCatalog } from "./types";

const catalog = catalogJson as LiveStationCatalog;

/** The curated station list, nearest to Hawler first (as built). */
export function listLiveStations(): LiveStation[] {
  return catalog.stations;
}

export function findLiveStation(id: string): LiveStation | undefined {
  return catalog.stations.find((station) => station.id === id);
}

export function liveStationCatalogBuiltAt(): string {
  return catalog.builtAt;
}

export const FDSN_SERVICE_BASE: Record<LiveStation["service"], string> = {
  earthscope: "https://service.earthscope.org/fdsnws",
  koeri: "https://eida.koeri.boun.edu.tr/fdsnws",
  geofon: "https://geofon.gfz.de/fdsnws",
};
