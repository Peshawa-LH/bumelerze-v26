import { View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

/** maplibre-gl's default marker, the pin the web's pin map and coordinate
 * picker drop: 27 × 41 with its soft shadow, the tip at the bottom centre
 * of the teardrop (y = 35). */
export const NATIVE_MAP_PIN_WIDTH = 27;
export const NATIVE_MAP_PIN_HEIGHT = 41;

const TEARDROP =
  "M27,13.5 C27,19.07 20.25,27 14.75,34.5 C14.02,35.5 12.98,35.5 12.25,34.5 " +
  "C6.75,27 0,19.22 0,13.5 C0,6.04 6.04,0 13.5,0 C20.96,0 27,6.04 27,13.5 Z";
const OUTLINE =
  "M13.5,0 C6.04,0 0,6.04 0,13.5 C0,19.22 6.75,27 12.25,34.5 C13,35.52 14.02,35.5 " +
  "14.75,34.5 C20.25,27 27,19.07 27,13.5 C27,6.04 20.96,0 13.5,0 Z M13.5,1 " +
  "C20.42,1 26,6.58 26,13.5 C26,15.9 24.5,19.18 22.22,22.74 C19.95,26.3 16.71,30.14 " +
  "13.94,33.91 C13.74,34.18 13.61,34.32 13.5,34.44 C13.39,34.32 13.26,34.18 13.06,33.91 " +
  "C10.28,30.13 7.41,26.31 5.02,22.77 C2.62,19.23 1,15.95 1,13.5 C1,6.58 6.58,1 13.5,1 Z";

/**
 * The pin itself, drawn in `color` (the web passes the same theme colour
 * to maplibre-gl's `Marker`). Decorative: the map around it carries the
 * accessible description.
 */
export function NativeMapPin({ color }: { color: string }) {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: NATIVE_MAP_PIN_WIDTH, height: NATIVE_MAP_PIN_HEIGHT }}
    >
      <Svg
        width={NATIVE_MAP_PIN_WIDTH}
        height={NATIVE_MAP_PIN_HEIGHT}
        viewBox="0 0 27 41"
      >
        <Circle cx={13.5} cy={35.5} r={5} fill="#000000" opacity={0.12} />
        <Path d={TEARDROP} fill={color} />
        <Path d={OUTLINE} fill="#000000" opacity={0.25} />
        <Circle cx={13.5} cy={13.5} r={5.5} fill="#000000" opacity={0.25} />
        <Circle cx={13.5} cy={13.5} r={5} fill="#FFFFFF" />
      </Svg>
    </View>
  );
}
