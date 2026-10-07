import Svg, { Circle, Path } from "react-native-svg";

import {
  BUMELERZE_MARK_DOT,
  BUMELERZE_MARK_PATH,
  BUMELERZE_MARK_VIEW_BOX,
} from "../bumelerze-mark";

interface BumelerzeMarkProps {
  /** Drawn width; the height follows the symbol's own proportions. */
  width: number;
  /** The one colour of the mark (a theme-derived value, never a literal). */
  color: string;
  testID?: string;
}

const { x, y, width: boxWidth, height: boxHeight } = BUMELERZE_MARK_VIEW_BOX;

/**
 * The Bumelerze symbol in a single colour, for the official badge: the same
 * tinted-circle treatment as the other badges instead of the red round app
 * icon. Decorative; the badge or role mark that holds it carries the label.
 * Vector (react-native-svg) so it takes the colour on every platform,
 * including web, and stays sharp at 18 px.
 */
export function BumelerzeMark({ width, color, testID }: BumelerzeMarkProps) {
  return (
    <Svg
      {...(testID === undefined ? {} : { testID })}
      width={width}
      height={(width * boxHeight) / boxWidth}
      viewBox={`${x} ${y} ${boxWidth} ${boxHeight}`}
    >
      <Path d={BUMELERZE_MARK_PATH} fill={color} />
      <Circle
        cx={BUMELERZE_MARK_DOT.cx}
        cy={BUMELERZE_MARK_DOT.cy}
        r={BUMELERZE_MARK_DOT.r}
        fill={color}
      />
    </Svg>
  );
}
