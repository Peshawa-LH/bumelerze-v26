/**
 * miniSEED 2 decoding for the iOS and Android station traces.
 *
 * The web decodes with `seisplotjs`, which cannot run on Hermes: its
 * `util.mjs` calls `customElements.define(...)` for a class extending
 * `HTMLElement` the moment it is imported (dist/util.mjs:242, version
 * 3.2.7), and every entry point, `seisplotjs/nodeonly` included, imports
 * it (`miniseed.mjs`, `datalink.mjs`). On the simulator, 2026-10-20:
 * "ReferenceError: Property 'customElements' doesn't exist".
 *
 * So this is a port of exactly what the web path uses from it
 * (`miniseed.parseDataRecords` + `seismogramPerChannel`): the fixed
 * header, blockettes 100 and 1000, the byte-order check, the sample-rate
 * formula, the Steim1/Steim2 and plain integer/float codecs, and the
 * merge of contiguous records into one segment per channel. The test
 * compares it sample for sample with seisplotjs on real records from all
 * three services the app reads (EarthScope, KOERI, GEOFON).
 */

export interface DecodedSegment {
  sampleRate: number;
  startMs: number;
  y: ArrayLike<number>;
}

interface RecordHeader {
  channel: string;
  startMs: number;
  numSamples: number;
  sampleRate: number;
  encoding: number;
  littleEndian: boolean;
  recordSize: number;
  dataOffset: number;
}

const SHORT = 1;
const INTEGER = 3;
const FLOAT = 4;
const DOUBLE = 5;
const DWWSSN = 16;
const STEIM1 = 10;
const STEIM2 = 11;

const DEFAULT_RECORD_SIZE = 4096;

function text(view: DataView, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1)
    out += String.fromCharCode(view.getUint8(offset + i));
  return out.trim();
}

/** BTime → epoch ms (seisplotjs: ordinal day, tenths of a millisecond
 * rounded to whole ms; the time-correction field and blockette 1001's
 * microseconds are not applied). */
function btimeMs(view: DataView, offset: number, swap: boolean): number {
  const year = view.getInt16(offset, swap);
  const jday = view.getInt16(offset + 2, swap);
  const hour = view.getInt8(offset + 4);
  const minute = view.getInt8(offset + 5);
  const second = view.getInt8(offset + 6);
  const tenthMilli = view.getInt16(offset + 8, swap);
  return Date.UTC(year, 0, jday, hour, minute, second) + Math.round(tenthMilli / 10);
}

/** A header written in the other byte order shows an impossible year. */
function needsByteSwap(view: DataView): boolean {
  const year = view.getInt16(20, false);
  const jday = view.getInt16(22, false);
  if (year === 1900 && jday === 1) return false;
  return year < 1960 || year > 2055;
}

/** Hz from the header's factor and multiplier (SEED's formula). */
export function sampleRateFromFactors(factor: number, multiplier: number): number {
  if (factor * multiplier === 0) return 10000;
  return (
    Math.pow(Math.abs(factor), factor / Math.abs(factor)) *
    Math.pow(Math.abs(multiplier), multiplier / Math.abs(multiplier))
  );
}

function parseHeader(view: DataView): RecordHeader {
  if (view.byteLength < 47) throw new Error("miniSEED record shorter than its header");
  const swap = needsByteSwap(view);
  const header: RecordHeader = {
    channel: [
      text(view, 18, 2),
      text(view, 8, 5),
      text(view, 13, 2),
      text(view, 15, 3),
    ].join("."),
    startMs: btimeMs(view, 20, swap),
    numSamples: view.getInt16(30, swap),
    sampleRate: sampleRateFromFactors(view.getInt16(32, swap), view.getInt16(34, swap)),
    encoding: 0,
    littleEndian: false,
    recordSize: DEFAULT_RECORD_SIZE,
    dataOffset: view.getUint16(44, swap),
  };
  const blockettes = view.getUint8(39);
  let offset = view.getUint16(46, swap);
  for (let i = 0; i < blockettes; i += 1) {
    const type = view.getUint16(offset, swap);
    let next = view.getUint16(offset + 2, swap);
    if (next === 0) next = header.dataOffset;
    if (type === 1000) {
      header.encoding = view.getUint8(offset + 4);
      header.littleEndian = view.getUint8(offset + 5) === 0;
      header.recordSize = 1 << view.getUint8(offset + 6);
    } else if (type === 100) {
      header.sampleRate = view.getFloat32(offset + 4);
    }
    if (next === offset || next === 0) break;
    offset = next;
  }
  return header;
}

// ---------------------------------------------------------------------------
// Codecs (ports of seisplotjs's seedcodec.mjs)
// ---------------------------------------------------------------------------

/** One Steim frame's values: in frame 0 the two integration constants come
 * first (nibble 0 words), then the differences. */
function steim1Frame(view: DataView, offset: number, le: boolean): number[] {
  const nibbles = view.getInt32(offset, le);
  const out: number[] = [];
  for (let i = 0; i < 16; i += 1) {
    const word = offset + i * 4;
    switch ((nibbles >> (30 - i * 2)) & 0x03) {
      case 0:
        if (offset === 0) out.push(view.getInt32(word, le));
        break;
      case 1:
        for (let n = 0; n < 4; n += 1) out.push(view.getInt8(word + n));
        break;
      case 2:
        out.push(view.getInt16(word, le), view.getInt16(word + 2, le));
        break;
      default:
        out.push(view.getInt32(word, le));
    }
  }
  return out;
}

function steim2Frame(view: DataView, offset: number, le: boolean): number[] {
  const nibbles = view.getUint32(offset, le);
  const out: number[] = [];
  for (let i = 0; i < 16; i += 1) {
    const word = offset + i * 4;
    const nibble = (nibbles >> (30 - i * 2)) & 0x03;
    if (nibble === 0) {
      if (offset === 0) out.push(view.getInt32(word, le));
      continue;
    }
    if (nibble === 1) {
      for (let n = 0; n < 4; n += 1) out.push(view.getInt8(word + n));
      continue;
    }
    const value = view.getUint32(word, le);
    const dnib = (value >> 30) & 0x03;
    let count: number;
    let bits: number;
    let skip: number;
    if (nibble === 2) {
      if (dnib === 1) [count, bits, skip] = [1, 30, 2];
      else if (dnib === 2) [count, bits, skip] = [2, 15, 2];
      else if (dnib === 3) [count, bits, skip] = [3, 10, 2];
      else throw new Error(`Steim2: unknown difference width (2, ${dnib})`);
    } else if (dnib === 0) [count, bits, skip] = [5, 6, 2];
    else if (dnib === 1) [count, bits, skip] = [6, 5, 2];
    else if (dnib === 2) [count, bits, skip] = [7, 4, 4];
    else throw new Error(`Steim2: unknown difference width (3, ${dnib})`);
    for (let d = 0; d < count; d += 1) {
      // Shift the difference to the top, then back with sign extension.
      out.push((value << (skip + d * bits)) >> (32 - bits));
    }
  }
  return out;
}

function decodeSteim(
  view: DataView,
  numSamples: number,
  le: boolean,
  frame: (view: DataView, offset: number, le: boolean) => number[],
): Int32Array {
  if (view.byteLength % 64 !== 0) {
    throw new Error(`Steim data is not whole 64-byte frames (${view.byteLength})`);
  }
  const samples = new Int32Array(numSamples);
  let current = 0;
  let last = 0;
  for (let f = 0; f < view.byteLength / 64 && current < numSamples; f += 1) {
    const values = frame(view, f * 64, le);
    let first = 0;
    if (f === 0) {
      // X(0) is the first sample; d(0) leads back to the previous record.
      last = (values[1] ?? 0) - (values[3] ?? 0);
      first = 3;
    }
    for (let j = first; j < values.length && current < numSamples; j += 1) {
      last = (last + (values[j] ?? 0)) | 0;
      samples[current] = last;
      current += 1;
    }
  }
  if (current !== numSamples) {
    throw new Error(`Steim: ${current} samples decoded, header says ${numSamples}`);
  }
  return samples;
}

function decodeData(view: DataView, header: RecordHeader): ArrayLike<number> {
  const n = header.numSamples;
  if (n === 0) return [];
  const le = header.littleEndian;
  switch (header.encoding) {
    case SHORT:
    case DWWSSN:
      return Int32Array.from({ length: n }, (_, i) => view.getInt16(i * 2, le));
    case INTEGER:
      return Int32Array.from({ length: n }, (_, i) => view.getInt32(i * 4, le));
    case FLOAT:
      return Float32Array.from({ length: n }, (_, i) => view.getFloat32(i * 4, le));
    case DOUBLE:
      return Float64Array.from({ length: n }, (_, i) => view.getFloat64(i * 8, le));
    case STEIM1:
      return decodeSteim(view, n, le, steim1Frame);
    case STEIM2:
      return decodeSteim(view, n, le, steim2Frame);
    default:
      throw new Error(`miniSEED encoding ${header.encoding} is not supported`);
  }
}

// ---------------------------------------------------------------------------
// Records → segments
// ---------------------------------------------------------------------------

interface DecodedRecord {
  header: RecordHeader;
  endMs: number;
  samples: ArrayLike<number>;
}

/** seisplotjs's `areContiguous`: the next record starts after this one
 * ends, within one and a half sample periods. */
function areContiguous(a: DecodedRecord, b: DecodedRecord): boolean {
  return (
    a.endMs < b.header.startMs && a.endMs + 1500 / a.header.sampleRate > b.header.startMs
  );
}

function joinSamples(records: DecodedRecord[]): ArrayLike<number> {
  const total = records.reduce((sum, record) => sum + record.samples.length, 0);
  const out = new Float64Array(total);
  let at = 0;
  for (const record of records) {
    for (let i = 0; i < record.samples.length; i += 1)
      out[at + i] = record.samples[i] as number;
    at += record.samples.length;
  }
  return out;
}

/**
 * Every record in `buffer` decoded and merged, per channel, into segments
 * of contiguous records (first-seen channel order, segments in time
 * order): the same segments the web gets from seisplotjs.
 */
export function decodeMiniSeed(buffer: ArrayBuffer): DecodedSegment[] {
  const byChannel = new Map<string, DecodedRecord[]>();
  let offset = 0;
  while (offset < buffer.byteLength) {
    const header = parseHeader(new DataView(buffer, offset));
    const data = new DataView(
      buffer,
      offset + header.dataOffset,
      Math.max(
        0,
        Math.min(header.recordSize, buffer.byteLength - offset) - header.dataOffset,
      ),
    );
    const record: DecodedRecord = {
      header,
      endMs: header.startMs + ((header.numSamples - 1) * 1000) / header.sampleRate,
      samples: decodeData(data, header),
    };
    const list = byChannel.get(header.channel) ?? [];
    list.push(record);
    byChannel.set(header.channel, list);
    offset += header.recordSize;
  }

  const segments: DecodedSegment[] = [];
  for (const records of byChannel.values()) {
    records.sort((a, b) => a.header.startMs - b.header.startMs);
    let run: DecodedRecord[] = [];
    const flush = () => {
      const first = run[0];
      if (first) {
        segments.push({
          sampleRate: first.header.sampleRate,
          startMs: first.header.startMs,
          y: joinSamples(run),
        });
      }
    };
    for (const record of records) {
      const previous = run[run.length - 1];
      if (previous && !areContiguous(previous, record)) {
        flush();
        run = [];
      }
      run.push(record);
    }
    flush();
  }
  return segments;
}
