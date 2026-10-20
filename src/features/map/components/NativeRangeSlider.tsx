import { useCallback, useRef, useState } from "react";
import {
  I18nManager,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import { useTheme } from "@/theme";

/**
 * A two-thumb range slider for the native map filters, standing in for the
 * web panel's pair of `<input type="range">` (React Native has no range
 * input, and the app adds no slider package for one control).
 *
 * One track, two thumbs: a touch moves the nearer thumb, so a finger can
 * start anywhere on the 44 pt row. Each thumb is its own adjustable
 * accessibility element with the web input's label, and VoiceOver's swipe
 * up/down moves it by `accessibilityStep`. The thumbs never cross (the web
 * clamps the same way). Positions follow the layout direction, so in
 * Sorani and Arabic the low end sits on the right, as the web's `dir="rtl"`
 * inputs do.
 */
export interface NativeRangeSliderProps {
  min: number;
  max: number;
  step: number;
  /** Step for VoiceOver's adjust gesture (defaults to `step`). */
  accessibilityStep?: number;
  low: number;
  high: number;
  onChange: (range: { low: number; high: number }) => void;
  lowLabel: string;
  highLabel: string;
  /** Spoken value of a thumb (formatted by the caller, localised digits). */
  formatValue: (value: number) => string;
  testID?: string;
}

const THUMB_PT = 24;
const ROW_PT = 44;
const TRACK_PT = 4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Snaps `value` to the `step` grid that starts at `min`. */
export function snapToStep(
  value: number,
  min: number,
  max: number,
  step: number,
): number {
  if (step <= 0) return clamp(value, min, max);
  const snapped = min + Math.round((value - min) / step) * step;
  // Floating-point steps (0.1) would otherwise leave 4.6000000000000005.
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return clamp(Number(snapped.toFixed(Math.min(decimals + 2, 10))), min, max);
}

/** Value at a touch `x` (px from the physical left) on a track `width`
 * wide, mirrored under a right-to-left layout. */
export function valueAtPosition(
  x: number,
  width: number,
  min: number,
  max: number,
  rtl: boolean,
): number {
  if (width <= 0 || max <= min) return min;
  const fraction = clamp(x / width, 0, 1);
  return min + (rtl ? 1 - fraction : fraction) * (max - min);
}

/** The thumb a touch at `value` takes: the nearer one; with both thumbs
 * on the same value, the side the touch is on. */
export function nearerThumb(value: number, low: number, high: number): "low" | "high" {
  const toLow = Math.abs(value - low);
  const toHigh = Math.abs(value - high);
  if (toLow !== toHigh) return toLow < toHigh ? "low" : "high";
  return value < low ? "low" : "high";
}

export function NativeRangeSlider({
  min,
  max,
  step,
  accessibilityStep,
  low,
  high,
  onChange,
  lowLabel,
  highLabel,
  formatValue,
  testID,
}: NativeRangeSliderProps) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const activeThumbRef = useRef<"low" | "high">("low");
  const rtl = I18nManager.isRTL;
  const span = max - min;
  const fractionOf = (value: number) =>
    span > 0 ? (clamp(value, min, max) - min) / span : 0;
  const usable = Math.max(0, width - THUMB_PT);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  }, []);

  const valueAt = useCallback(
    (x: number) =>
      snapToStep(
        valueAtPosition(x - THUMB_PT / 2, usable, min, max, rtl),
        min,
        max,
        step,
      ),
    [usable, min, max, rtl, step],
  );

  const moveTo = useCallback(
    (x: number, pickThumb: boolean) => {
      const value = valueAt(x);
      if (pickThumb) {
        activeThumbRef.current = nearerThumb(value, low, high);
      }
      if (activeThumbRef.current === "low") {
        onChange({ low: Math.min(value, high), high });
      } else {
        onChange({ low, high: Math.max(value, low) });
      }
    },
    [valueAt, low, high, onChange],
  );

  // The callbacks run on touch events (on the JS thread), never during
  // render; the ref only remembers which thumb the touch took.
  const gesture = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .activeOffsetX([-4, 4])
    .failOffsetY([-12, 12])
    // eslint-disable-next-line react-hooks/refs -- gesture callback, not render
    .onBegin((event) => moveTo(event.x, true))
    // eslint-disable-next-line react-hooks/refs -- gesture callback, not render
    .onUpdate((event) => moveTo(event.x, false));

  const adjust = (thumb: "low" | "high", direction: 1 | -1) => {
    const delta = (accessibilityStep ?? step) * direction;
    if (thumb === "low") {
      onChange({ low: clamp(snapToStep(low + delta, min, max, step), min, high), high });
    } else {
      onChange({ low, high: clamp(snapToStep(high + delta, min, max, step), low, max) });
    }
  };

  const thumb = (which: "low" | "high") => {
    const value = which === "low" ? low : high;
    return (
      <View
        key={which}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={which === "low" ? lowLabel : highLabel}
        accessibilityValue={{ text: formatValue(value) }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(event: AccessibilityActionEvent) =>
          adjust(which, event.nativeEvent.actionName === "increment" ? 1 : -1)
        }
        testID={testID ? `${testID}-${which}` : undefined}
        style={[
          styles.thumbHit,
          { start: fractionOf(value) * usable + THUMB_PT / 2 - ROW_PT / 2 },
        ]}
      >
        <View
          style={[
            styles.thumb,
            { backgroundColor: colors.surface.raised, borderColor: colors.brand.primary },
          ]}
        />
      </View>
    );
  };

  const lowFraction = fractionOf(low);
  const highFraction = fractionOf(high);

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.row} onLayout={handleLayout} testID={testID}>
        <View
          style={[
            styles.track,
            {
              backgroundColor: colors.border.default,
              start: THUMB_PT / 2,
              end: THUMB_PT / 2,
            },
          ]}
        />
        <View
          style={[
            styles.track,
            {
              backgroundColor: colors.brand.primary,
              start: THUMB_PT / 2 + lowFraction * usable,
              width: Math.max(0, (highFraction - lowFraction) * usable),
            },
          ]}
        />
        {thumb("low")}
        {thumb("high")}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  row: {
    height: ROW_PT,
    justifyContent: "center",
  },
  track: {
    position: "absolute",
    height: TRACK_PT,
    borderRadius: TRACK_PT / 2,
    top: (ROW_PT - TRACK_PT) / 2,
  },
  thumbHit: {
    position: "absolute",
    top: 0,
    width: ROW_PT,
    height: ROW_PT,
    alignItems: "center",
    justifyContent: "center",
  },
  thumb: {
    width: THUMB_PT,
    height: THUMB_PT,
    borderRadius: THUMB_PT / 2,
    borderWidth: 2,
    shadowColor: "#000000",
    shadowOpacity: 0.2,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
});
