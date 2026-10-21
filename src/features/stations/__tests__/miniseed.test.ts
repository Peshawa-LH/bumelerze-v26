import { readFileSync } from "fs";
import { join } from "path";

import { decodeMiniSeed, sampleRateFromFactors } from "../miniseed";
import { mergeSegments } from "../trace-transport";

/**
 * The native miniSEED decoder against seisplotjs, the decoder the web uses.
 * `__fixtures__/*.mseed` are the first eight 512-byte records of a real
 * ten-minute dataselect answer from each service the app reads (EarthScope
 * MP.KIR1, KOERI KO.CUKT, GEOFON GE.ARPR; all Steim2), one with a record
 * removed to make a gap, and of a one-hour answer from Raspberry Shake
 * (AM.R079D EHZ, Steim2, 2026-10-21). `seisplotjs-decoded.json` is
 * seisplotjs 3.2.7's own `parseDataRecords` + `seismogramPerChannel` output
 * for the same bytes (run in Node with stubbed DOM globals, 2026-10-20 and
 * 2026-10-21).
 */

const FIXTURES = join(__dirname, "..", "__fixtures__");

interface ExpectedSegment {
  sampleRate: number;
  startMs: number;
  y: number[];
}

const expected = JSON.parse(
  readFileSync(join(FIXTURES, "seisplotjs-decoded.json"), "utf8"),
) as Record<string, ExpectedSegment[]>;

function load(file: string): ArrayBuffer {
  const bytes = readFileSync(join(FIXTURES, file));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

describe("decodeMiniSeed (native) matches seisplotjs (web)", () => {
  it.each(Object.keys(expected))("decodes %s sample for sample", (file) => {
    const segments = decodeMiniSeed(load(file));
    const reference = expected[file] ?? [];
    expect(segments).toHaveLength(reference.length);
    segments.forEach((segment, index) => {
      const want = reference[index] as ExpectedSegment;
      expect(segment.sampleRate).toBe(want.sampleRate);
      expect(segment.startMs).toBe(want.startMs);
      expect(Array.from(segment.y)).toEqual(want.y);
    });
  });

  it("splits a gap into two segments, which the trace merge bridges flat", () => {
    const segments = decodeMiniSeed(load("earthscope-MP-KIR1-HHZ-gap.mseed"));
    expect(segments).toHaveLength(2);
    const merged = mergeSegments(segments);
    const whole = mergeSegments(decodeMiniSeed(load("earthscope-MP-KIR1-HHZ.mseed")));
    // Same window, same length: the missing record is bridged, not dropped.
    expect(merged?.samples.length).toBe(whole?.samples.length);
    expect(merged?.startMs).toBe(whole?.startMs);
  });

  it("decodes the Raspberry Shake in Hawler (AM.R079D EHZ, Steim2)", () => {
    const buffer = load("raspberryshake-AM-R079D-EHZ.mseed");
    // Blockette 1000 right after the fixed header: encoding 11 = Steim2,
    // record length 2^9 = 512 bytes.
    const view = new DataView(buffer);
    expect(view.getUint16(48)).toBe(1000);
    expect(view.getUint8(52)).toBe(11);
    expect(view.getUint8(54)).toBe(9);
    const segments = decodeMiniSeed(buffer);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.sampleRate).toBe(100);
    expect(segments[0]?.startMs).toBe(Date.parse("2026-10-21T12:34:31.222Z"));
    expect(segments[0]?.y.length).toBe(2133);
  });

  it("returns nothing for an empty answer", () => {
    expect(decodeMiniSeed(new ArrayBuffer(0))).toEqual([]);
  });
});

describe("sampleRateFromFactors", () => {
  it("follows SEED's factor/multiplier rule", () => {
    expect(sampleRateFromFactors(100, 1)).toBe(100);
    expect(sampleRateFromFactors(20, 1)).toBe(20);
    expect(sampleRateFromFactors(-10, 1)).toBeCloseTo(0.1);
    expect(sampleRateFromFactors(1, -10)).toBeCloseTo(0.1);
    expect(sampleRateFromFactors(0, 1)).toBe(10000);
  });
});
