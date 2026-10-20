import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useTheme, nativeFontFamily, READING_START } from "@/theme";

import { parseFilterInput } from "../filter-input";

interface NumericStepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  formatValue: (value: number) => string;
  onChange: (value: number) => void;
  decrementA11yLabel: string;
  incrementA11yLabel: string;
  /** Decimal places a typed value is rounded to (0 = whole numbers). */
  decimals?: number;
  /** False shows the value without letting it be typed into (the tour's
   * still preview). */
  editable?: boolean;
  testID?: string;
}

/** Press-and-hold repeat delay/interval (ms) — starts slow so a single tap
 * still reads as one discrete step, then repeats quickly enough to cross
 * the catalog's full year range (872-2023, `CATALOG_YEAR_STEP` decades
 * apart) in a few seconds of holding rather than requiring 100+ taps. */
export const HOLD_REPEAT_START_DELAY_MS = 400;
export const HOLD_REPEAT_INTERVAL_MS = 90;

/**
 * The value in the middle is also a text box (review note 9.1): type a
 * number on the numeric keypad, in ASCII or Eastern Arabic-Indic digits
 * (٤٫٥ as well as 4.5); it is applied on blur or "done", clamped into
 * [min, max] and rounded to `decimals`. Anything that is not a number puts
 * the last good value back.
 *
 * A boring, big-touch-target −/value/+ control (brief: "boring RN
 * controls, big touch targets") shared by the magnitude and year range
 * filters.
 *
 * Tap and hold (review A-1, 2026-10-14): a tap steps once, through
 * `onPress` — on the web a quick touch or a mouse click never reached
 * `onPressIn`, so the buttons looked dead. Holding steps once more every
 * `HOLD_REPEAT_INTERVAL_MS` after `HOLD_REPEAT_START_DELAY_MS`, from the
 * LATEST value (a ref, not the value of the render the press began in), and
 * the `onPress` that follows the release of a hold is swallowed, so a hold
 * never ends with an extra step.
 */
export function NumericStepper({
  label,
  value,
  min,
  max,
  step,
  formatValue,
  onChange,
  decrementA11yLabel,
  incrementA11yLabel,
  decimals = 0,
  editable = true,
  testID,
}: NumericStepperProps) {
  const { colors, typography, spacing } = useTheme();
  // Text being typed; null while the box is not being edited (then it shows
  // the formatted value).
  const [draft, setDraft] = useState<string | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  // Always the latest value: the repeat interval reads it, so every repeat
  // steps from where the previous one left the value (`step_` writes it at
  // once; the effect catches a value changed from outside, e.g. typed in).
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  // Set once a hold has stepped on its own; the release's `onPress` then
  // does nothing.
  const heldRef = useRef(false);

  useEffect(() => {
    return () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
      if (holdInterval.current) clearInterval(holdInterval.current);
    };
  }, []);

  function clamp(next: number): number {
    return Math.min(max, Math.max(min, Math.round(next * 100) / 100));
  }

  /** One step from the latest value; false when the limit was already reached. */
  function step_(direction: 1 | -1): boolean {
    const next = clamp(valueRef.current + direction * step);
    if (next === valueRef.current) {
      return false;
    }
    valueRef.current = next;
    onChange(next);
    return true;
  }

  function endHold() {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    if (holdInterval.current) {
      clearInterval(holdInterval.current);
      holdInterval.current = null;
    }
  }

  function startHold(direction: 1 | -1) {
    endHold();
    heldRef.current = false;
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      holdInterval.current = setInterval(() => {
        heldRef.current = true;
        if (!step_(direction)) {
          endHold();
        }
      }, HOLD_REPEAT_INTERVAL_MS);
    }, HOLD_REPEAT_START_DELAY_MS);
  }

  function tap(direction: 1 | -1) {
    if (heldRef.current) {
      // The release of a hold that already stepped: not one more step.
      heldRef.current = false;
      return;
    }
    step_(direction);
  }

  function commitDraft() {
    if (draft === null) {
      return;
    }
    const parsed = parseFilterInput(draft, { min, max, decimals });
    setDraft(null);
    if (parsed !== null && parsed !== value) {
      onChange(parsed);
    }
  }

  return (
    <View style={[styles.container, { gap: spacing[1] }]}>
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.labelCaption.fontSize,
          fontFamily: nativeFontFamily(typography.labelCaption, "400"),
          ...READING_START,
          lineHeight: typography.labelCaption.lineHeight,
        }}
      >
        {label}
      </Text>
      <View
        style={[
          styles.row,
          { borderColor: colors.border.default, gap: spacing[2] },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={decrementA11yLabel}
          disabled={value <= min}
          onPressIn={() => startHold(-1)}
          onPressOut={endHold}
          onPress={() => tap(-1)}
          style={[styles.button, { opacity: value <= min ? 0.4 : 1 }]}
        >
          <Text style={{ color: colors.text.primary, fontSize: typography.h3.fontSize, fontFamily: nativeFontFamily(typography.h3, "400"), ...READING_START }}>
            −
          </Text>
        </Pressable>
        <TextInput
          testID={testID}
          accessibilityLabel={label}
          allowFontScaling
          editable={editable}
          value={draft ?? formatValue(value)}
          onFocus={() => setDraft(formatValue(value))}
          onChangeText={setDraft}
          onBlur={commitDraft}
          onSubmitEditing={commitDraft}
          keyboardType={decimals > 0 ? "decimal-pad" : "number-pad"}
          inputMode={decimals > 0 ? "decimal" : "numeric"}
          returnKeyType="done"
          selectTextOnFocus
          maxLength={8}
          style={[
            styles.input,
            {
              color: colors.text.primary,
              fontSize: typography.bodyDefault.fontSize,
              fontFamily: nativeFontFamily(typography.bodyDefault),
            },
          ]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={incrementA11yLabel}
          disabled={value >= max}
          onPressIn={() => startHold(1)}
          onPressOut={endHold}
          onPress={() => tap(1)}
          style={[styles.button, { opacity: value >= max ? 0.4 : 1 }]}
        >
          <Text style={{ color: colors.text.primary, fontSize: typography.h3.fontSize, fontFamily: nativeFontFamily(typography.h3, "400"), ...READING_START }}>
            +
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minWidth: 140,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 4,
  },
  input: {
    fontVariant: ["tabular-nums"],
    minWidth: 56,
    minHeight: 44,
    flexShrink: 1,
    paddingVertical: 0,
    paddingHorizontal: 0,
    textAlign: "center",
  },
  button: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
});
