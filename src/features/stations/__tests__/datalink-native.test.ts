import { readFileSync } from "fs";
import { join } from "path";

import { canStream, nativeStreamPattern, streamPattern } from "../datalink";
import {
  DATALINK_WS_SUBPROTOCOL,
  encodeDataLinkCommand,
  openDataLinkStream,
  parseDataLinkFrame,
  segmentsFromPacket,
} from "../datalink-native";
import type { LiveStation } from "../types";

const KIR1 = {
  net: "MP",
  sta: "KIR1",
  channel: "HHZ",
  service: "earthscope",
} as LiveStation;

function text(buffer: ArrayBuffer): string {
  return String.fromCharCode(...new Uint8Array(buffer));
}

/** A server frame: DL, header length, header, data. */
function serverFrame(header: string, data: Uint8Array = new Uint8Array(0)): ArrayBuffer {
  const out = new Uint8Array(3 + header.length + data.length);
  out.set([68, 76, header.length]);
  for (let i = 0; i < header.length; i += 1) out[3 + i] = header.charCodeAt(i);
  out.set(data, 3 + header.length);
  return out.buffer;
}

function record(): Uint8Array {
  // One 512-byte record of the real KIR1 fixture.
  return new Uint8Array(
    readFileSync(join(__dirname, "..", "__fixtures__", "earthscope-MP-KIR1-HHZ.mseed")),
  ).slice(0, 512);
}

describe("DataLink framing (seisplotjs's encodeDL)", () => {
  it("frames a bare command", () => {
    expect(text(encodeDataLinkCommand("STREAM"))).toBe("DL\u0006STREAM");
  });

  it("names the data length at the end of the header", () => {
    expect(text(encodeDataLinkCommand("MATCH", "^MP_KIR1$"))).toBe(
      "DL\u0007MATCH 9^MP_KIR1$",
    );
  });

  it("reads a server response and a packet", () => {
    expect(
      parseDataLinkFrame(serverFrame("OK 1 30", new TextEncoder().encode("1 streams"))),
    ).toEqual({ kind: "response", type: "OK", header: "OK 1 30", message: "1 streams" });
    const packet = parseDataLinkFrame(
      serverFrame("PACKET FDSN:MP_KIR1_00_H_H_Z/MSEED 77 1 2 3 512", record()),
    );
    expect(packet).toMatchObject({
      kind: "packet",
      streamId: "FDSN:MP_KIR1_00_H_H_Z/MSEED",
    });
    expect(packet?.kind === "packet" && packet.data.byteLength).toBe(512);
    expect(parseDataLinkFrame(new Uint8Array([1, 2, 3]).buffer)).toBeNull();
  });

  it("decodes the miniSEED a packet carries", () => {
    const packet = parseDataLinkFrame(
      serverFrame("PACKET FDSN:MP_KIR1_00_H_H_Z/MSEED 77 1 2 3 512", record()),
    )!;
    const [segment] = segmentsFromPacket(packet);
    expect(segment?.sampleRate).toBe(100);
    expect(segment?.y.length).toBeGreaterThan(0);
    const json = parseDataLinkFrame(
      serverFrame("PACKET X/JSON 1 1 2 3 2", new Uint8Array(2)),
    )!;
    expect(segmentsFromPacket(json)).toEqual([]);
  });
});

describe("openDataLinkStream", () => {
  function fakeSocket() {
    const sent: string[] = [];
    const socket = {
      binaryType: "",
      protocol: "",
      onopen: null as (() => void) | null,
      onmessage: null as ((event: { data: unknown }) => void) | null,
      onerror: null as ((event: unknown) => void) | null,
      onclose: null as (() => void) | null,
      send: (data: ArrayBuffer) => sent.push(text(data).slice(3)),
      close: jest.fn(),
    };
    return { socket, sent };
  }

  it("says ID, matches, streams, then hands over decoded packets", () => {
    const { socket, sent } = fakeSocket();
    const factory = jest.fn(() => socket);
    const onSegment = jest.fn();
    const onError = jest.fn();
    const close = openDataLinkStream("wss://ring", "^P$", onSegment, onError, factory);
    expect(factory).toHaveBeenCalledWith("wss://ring", DATALINK_WS_SUBPROTOCOL);
    expect(socket.binaryType).toBe("arraybuffer");

    socket.onopen?.();
    expect(sent[0]).toMatch(/^ID bumelerze:app:\d+:javascript$/);
    socket.onmessage?.({ data: serverFrame("ID DataLink v1.1 :: DLPROTO:1.1") });
    expect(sent[1]).toBe("MATCH 3^P$");
    socket.onmessage?.({ data: serverFrame("OK 1 30") });
    expect(sent[2]).toBe("STREAM");

    socket.onmessage?.({
      data: serverFrame("PACKET FDSN:MP_KIR1_00_H_H_Z/MSEED 1 1 2 3 512", record()),
    });
    expect(onSegment).toHaveBeenCalledWith(expect.objectContaining({ sampleRate: 100 }));
    expect(onError).not.toHaveBeenCalled();

    close();
    expect(socket.close).toHaveBeenCalled();
  });

  it("reports a refused command and a lost connection once", () => {
    const { socket } = fakeSocket();
    const onError = jest.fn();
    openDataLinkStream("wss://ring", "^P$", jest.fn(), onError, () => socket);
    socket.onopen?.();
    socket.onmessage?.({
      data: serverFrame("ERROR 0 5", new TextEncoder().encode("nope!")),
    });
    socket.onclose?.();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0].message).toBe("DataLink: nope!");
  });
});

describe("nativeStreamPattern", () => {
  it("[regression] matches EarthScope's FDSN source ids, which the older pattern does not", () => {
    // The ring answered "0 streams selected" for streamPattern on
    // 2026-10-21: its ids are FDSN:NET_STA_LOC_B_S_SS/MSEED now.
    const native = new RegExp(nativeStreamPattern(KIR1));
    expect(native.test("FDSN:MP_KIR1_00_H_H_Z/MSEED")).toBe(true);
    expect(native.test("MP_KIR1_00_HHZ/MSEED")).toBe(true);
    expect(native.test("FDSN:MP_KIR1_00_H_H_N/MSEED")).toBe(false);
    expect(native.test("FDSN:KO_KIR1_00_H_H_Z/MSEED")).toBe(false);
    expect(new RegExp(streamPattern(KIR1)).test("FDSN:MP_KIR1_00_H_H_Z/MSEED")).toBe(
      false,
    );
  });

  it("streams EarthScope stations on every platform; KOERI and GEOFON keep polling", () => {
    expect(canStream(KIR1)).toBe(true);
    expect(canStream({ ...KIR1, service: "koeri" })).toBe(false);
    expect(canStream({ ...KIR1, service: "geofon" })).toBe(false);
  });
});
