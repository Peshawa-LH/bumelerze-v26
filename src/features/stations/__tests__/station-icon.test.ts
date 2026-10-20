import { inflateSync } from "zlib";

import {
  rasterizeStationIcon,
  signedDistanceToTriangle,
  STATION_ICON_PX,
  stationIconDataUri,
} from "../station-icon";

/** Reads the RGBA pixels back out of the PNG (Node's own inflate). */
function decodePng(uri: string): { width: number; height: number; rgba: Uint8Array } {
  const bytes = Buffer.from(uri.replace("data:image/png;base64,", ""), "base64");
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  let offset = 8;
  let idat = Buffer.alloc(0);
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT")
      idat = Buffer.concat([idat, bytes.subarray(offset + 8, offset + 8 + length)]);
    offset += 12 + length;
  }
  const raw = inflateSync(idat);
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    expect(raw[y * (1 + width * 4)]).toBe(0);
    rgba.set(
      raw.subarray(y * (1 + width * 4) + 1, (y + 1) * (1 + width * 4)),
      y * width * 4,
    );
  }
  return { width, height, rgba };
}

function pixel(rgba: Uint8Array, x: number, y: number): number[] {
  const i = (y * STATION_ICON_PX + x) * 4;
  return [...rgba.subarray(i, i + 4)];
}

describe("station icon (the web's canvas triangle, for MapLibre Native)", () => {
  it("is a valid 36 × 36 PNG whose pixels are the rasterised triangle", () => {
    const { width, height, rgba } = decodePng(stationIconDataUri("#C3202B"));
    expect([width, height]).toEqual([36, 36]);
    expect(rgba).toEqual(rasterizeStationIcon("#C3202B"));
  });

  it("fills with the tier colour, outlines in white and leaves the corners clear", () => {
    const rgba = rasterizeStationIcon("#C3202B");
    expect(pixel(rgba, 18, 22)).toEqual([0xc3, 0x20, 0x2b, 255]);
    // On the bottom edge (y = 32): the 3 px white outline.
    expect(pixel(rgba, 18, 31)).toEqual([255, 255, 255, 255]);
    expect(pixel(rgba, 0, 0)[3]).toBe(0);
    expect(pixel(rgba, 35, 35)[3]).toBe(0);
  });

  it("measures the outline distance with the sign inside negative", () => {
    expect(signedDistanceToTriangle([18, 22])).toBeLessThan(0);
    expect(signedDistanceToTriangle([1, 1])).toBeGreaterThan(0);
    expect(Math.abs(signedDistanceToTriangle([18, 32]))).toBeCloseTo(0);
  });

  it("keeps one image per colour", () => {
    expect(stationIconDataUri("#A6A6AA")).toBe(stationIconDataUri("#A6A6AA"));
    expect(stationIconDataUri("#A6A6AA")).not.toBe(stationIconDataUri("#C77E12"));
  });
});
