import genMatrix from "react-native-qrcode-svg/src/genMatrix";

export interface QrDrawing {
  /** Number of modules per side. */
  modules: number;
  /** SVG path data of every dark module, in a `size` x `size` box. */
  path: string;
}

/**
 * A QR code for `value` as one SVG path of dark squares, so it draws inside
 * the card's own <Svg> (no nested SVG, no raster). Horizontal runs of dark
 * modules are merged into one rectangle each, which keeps the path short on a
 * low-end phone. Error correction M: the event link is short, and M survives a
 * screenshot recompressed by a messenger.
 */
export function buildQrPath(value: string, size: number): QrDrawing {
  const matrix = genMatrix(value, "M");
  const modules = matrix.length;
  const cell = size / modules;
  const round = (n: number) => Math.round(n * 100) / 100;
  let path = "";
  matrix.forEach((row, rowIndex) => {
    let runStart = -1;
    for (let column = 0; column <= modules; column += 1) {
      const dark = column < modules && Boolean(row[column]);
      if (dark && runStart < 0) {
        runStart = column;
      } else if (!dark && runStart >= 0) {
        path += `M${round(runStart * cell)} ${round(rowIndex * cell)}h${round((column - runStart) * cell)}v${round(cell)}h${round(-(column - runStart) * cell)}z`;
        runStart = -1;
      }
    }
  });
  return { modules, path };
}
