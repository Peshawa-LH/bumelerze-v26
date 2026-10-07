import Svg, { Circle, Ellipse, Path, Polygon, Rect } from "react-native-svg";

import { useTheme } from "@/theme";

/** The shaking bands drawn, outer to inner: intensity level, x/y radius. */
const BANDS: readonly { level: number; rx: number; ry: number }[] = [
  { level: 4, rx: 82, ry: 54 },
  { level: 5, rx: 60, ry: 40 },
  { level: 6, rx: 40, ry: 27 },
  { level: 7, rx: 20, ry: 14 },
];

const CENTER_X = 100;
const CENTER_Y = 70;
const STAR =
  "100,60 103,67 110.5,67.5 104.8,72.4 106.6,79.7 100,75.8 93.4,79.7 95.2,72.4 89.5,67.5 96.9,67";

export interface MiniShakingMapProps {
  /** Rendered width; the drawing keeps its 10:7 shape. */
  width: number;
  /** Fault lines and event dots (the map stop) or the bands alone (the card). */
  detail?: boolean;
}

/**
 * A small still picture of a shaking map: nested intensity bands round an
 * epicentre star, optionally with a few fault lines and event dots. Pure SVG
 * and theme colours (the same intensity ramp as the real map), no tiles and no
 * network, so the tour stays light and works offline. Never mirrored: a map
 * does not flip in right-to-left languages.
 */
export function MiniShakingMap({ width, detail = true }: MiniShakingMapProps) {
  const { colors } = useTheme();
  const height = (width * 7) / 10;
  return (
    <Svg width={width} height={height} viewBox="0 0 200 140">
      <Rect x={0} y={0} width={200} height={140} fill={colors.surface.sunken} />
      <Path
        d="M0 100 C40 88 70 112 110 98 S170 84 200 96"
        stroke={colors.border.default}
        strokeWidth={1.5}
        fill="none"
      />
      <Path
        d="M30 0 C46 30 36 52 52 80 S60 120 48 140"
        stroke={colors.border.default}
        strokeWidth={1.5}
        fill="none"
      />
      {BANDS.map((band) => (
        <Ellipse
          key={band.level}
          cx={CENTER_X}
          cy={CENTER_Y}
          rx={band.rx}
          ry={band.ry}
          rotation={-18}
          origin={`${CENTER_X}, ${CENTER_Y}`}
          fill={colors.intensity[band.level] ?? colors.status.warning}
          fillOpacity={0.62}
        />
      ))}
      {detail ? (
        <>
          <Path
            d="M14 118 L66 84 L112 74 L186 30"
            stroke={colors.text.secondary}
            strokeWidth={1.6}
            strokeDasharray="5 3"
            fill="none"
          />
          <Path
            d="M120 138 L150 102 L196 88"
            stroke={colors.text.secondary}
            strokeWidth={1.6}
            strokeDasharray="5 3"
            fill="none"
          />
          <Circle cx={36} cy={34} r={4} fill={colors.magnitudeBand.minor} />
          <Circle cx={160} cy={116} r={5.5} fill={colors.magnitudeBand.light} />
          <Circle cx={172} cy={22} r={3.5} fill={colors.magnitudeBand.minor} />
        </>
      ) : null}
      <Polygon
        points={STAR}
        fill={colors.surface.raised}
        stroke={colors.text.primary}
        strokeWidth={1.4}
      />
    </Svg>
  );
}
