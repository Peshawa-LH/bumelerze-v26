/**
 * The spectrum plot for the printed report, as inline SVG.
 *
 * Deliberately not a screenshot of the on-screen chart: capturing a canvas
 * would give a fixed-resolution bitmap that prints soft, and the on-screen
 * chart is themed for a dark or light UI rather than for paper. This draws
 * the same points again in print colours — black on white, labelled axes,
 * a visible grid — so the page is legible photocopied.
 */

export interface ReportChartPoint {
  t: number;
  sa: number;
}

export interface ReportChartSeries {
  points: readonly ReportChartPoint[];
  /** Dashed rather than solid, for a secondary series such as the reduced
   * curve. */
  dashed?: boolean;
  label: string;
}

const WIDTH = 520;
const HEIGHT = 300;
const LEFT = 52;
const RIGHT = 14;
const TOP = 14;
const BOTTOM = 42;

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalised = value / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

export function buildReportChartSvg(
  series: readonly ReportChartSeries[],
  tMax: number,
  axisLabels: { period: string; acceleration: string },
): string {
  const all = series.flatMap((s) => s.points);
  if (all.length === 0) {
    return "";
  }
  const yMax = niceMax(Math.max(...all.map((p) => p.sa)) * 1.05);
  const plotW = WIDTH - LEFT - RIGHT;
  const plotH = HEIGHT - TOP - BOTTOM;

  const toX = (t: number) => LEFT + (t / tMax) * plotW;
  const toY = (sa: number) => TOP + plotH - (sa / yMax) * plotH;

  const gridX = Array.from({ length: 5 }, (_, i) => (tMax / 4) * i);
  const gridY = Array.from({ length: 5 }, (_, i) => (yMax / 4) * i);

  const grid = [
    ...gridX.map(
      (t) =>
        `<line x1="${toX(t).toFixed(1)}" y1="${TOP}" x2="${toX(t).toFixed(1)}" y2="${TOP + plotH}" stroke="#ddd" stroke-width="0.6"/>` +
        `<text x="${toX(t).toFixed(1)}" y="${TOP + plotH + 14}" font-size="9" text-anchor="middle" fill="#333">${t.toFixed(1)}</text>`,
    ),
    ...gridY.map(
      (sa) =>
        `<line x1="${LEFT}" y1="${toY(sa).toFixed(1)}" x2="${LEFT + plotW}" y2="${toY(sa).toFixed(1)}" stroke="#ddd" stroke-width="0.6"/>` +
        `<text x="${LEFT - 6}" y="${(toY(sa) + 3).toFixed(1)}" font-size="9" text-anchor="end" fill="#333">${sa.toFixed(2)}</text>`,
    ),
  ].join("");

  const lines = series
    .filter((s) => s.points.length > 1)
    .map((s) => {
      const d = s.points
        .filter((p) => p.t <= tMax)
        .map((p) => `${toX(p.t).toFixed(1)},${toY(p.sa).toFixed(1)}`)
        .join(" ");
      return `<polyline points="${d}" fill="none" stroke="#000" stroke-width="${s.dashed ? 1.2 : 2}"${s.dashed ? ' stroke-dasharray="5 3"' : ""}/>`;
    })
    .join("");

  const legend = series
    .filter((s) => s.points.length > 1)
    .map((s, i) => {
      const y = TOP + 12 + i * 14;
      return (
        `<line x1="${LEFT + plotW - 130}" y1="${y}" x2="${LEFT + plotW - 106}" y2="${y}" stroke="#000" stroke-width="${s.dashed ? 1.2 : 2}"${s.dashed ? ' stroke-dasharray="5 3"' : ""}/>` +
        `<text x="${LEFT + plotW - 100}" y="${y + 3}" font-size="9" fill="#111">${s.label}</text>`
      );
    })
    .join("");

  return `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg" role="img">
<rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="#fff"/>
${grid}
<line x1="${LEFT}" y1="${TOP}" x2="${LEFT}" y2="${TOP + plotH}" stroke="#111" stroke-width="1"/>
<line x1="${LEFT}" y1="${TOP + plotH}" x2="${LEFT + plotW}" y2="${TOP + plotH}" stroke="#111" stroke-width="1"/>
${lines}
${legend}
<text x="${LEFT + plotW / 2}" y="${HEIGHT - 6}" font-size="10" text-anchor="middle" fill="#111">${axisLabels.period}</text>
<text x="12" y="${TOP + plotH / 2}" font-size="10" text-anchor="middle" fill="#111" transform="rotate(-90 12 ${TOP + plotH / 2})">${axisLabels.acceleration}</text>
</svg>`;
}
