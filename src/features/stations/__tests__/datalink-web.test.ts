/**
 * The web's DataLink client (seisplotjs) asks the ring for the station with
 * the same pattern as the phone: EarthScope names streams by FDSN source id
 * now, and the old `NET_STA_LOC_CHAN` pattern selected nothing, so the web's
 * live trace silently fell back to polling.
 */
import { Platform } from "react-native";

import { openStationStream } from "../datalink";
import type { LiveStation } from "../types";

const mockMatch = jest.fn(async (_pattern: string) => undefined);
jest.mock(
  "seisplotjs",
  () => ({
    datalink: {
      DataLinkConnection: jest.fn().mockImplementation(() => ({
        connect: async () => undefined,
        match: mockMatch,
        stream: async () => undefined,
        close: () => undefined,
      })),
    },
    miniseed: { seismogramPerChannel: () => [] },
  }),
  // Jest cannot resolve seisplotjs's ESM-only entry; the web build does.
  { virtual: true },
);

const KIR1 = {
  id: "MP.KIR1",
  net: "MP",
  sta: "KIR1",
  channel: "HHZ",
  service: "earthscope",
} as unknown as LiveStation;

describe("openStationStream on the web", () => {
  const original = Platform.OS;
  afterEach(() => {
    Platform.OS = original;
  });

  it("[regression] selects EarthScope's FDSN-named stream", async () => {
    Platform.OS = "web";
    const close = openStationStream(KIR1, jest.fn(), jest.fn());
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockMatch).toHaveBeenCalledTimes(1);
    const pattern = new RegExp(mockMatch.mock.calls[0]![0]);
    expect(pattern.test("FDSN:MP_KIR1_00_H_H_Z/MSEED")).toBe(true);
    expect(pattern.test("MP_KIR1_00_HHZ/MSEED")).toBe(true);
    close();
  });
});
