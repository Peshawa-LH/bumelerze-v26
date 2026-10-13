import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useTheme } from "@/theme";

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
  testID?: string;
}

/** Press-and-hold repeat delay/interval (ms) — starts slow so a single tap
 * still reads as one discrete step, then repeats quickly enough to cross
 * the catalog's full year range (872-2023, `CATALOG_YEAR_STEP` decades
 * apart) in a few seconds of holding rather than requiring 100+ taps. */
const HOLD_REPEAT_START_DELAY_MS = 400;
const HOLD_REPEAT_INTERVAL_MS = 90;

/**
 * The value in the middle is also a text box (review note 9.1): type a
 * number on the numeric keypad, in ASCII or Eastern Arabic-Indic digits
 * (٤٫٥ as well as 4.5); it is applied on blur or "done", clamped into
 * [min, max] and rounded to `decimals`. Anything that is not a number puts
 * the last good value back.
 *
 * A boring, big-touch-target −/value/+ control (wave brief: "boring RN
 * controls, big touch targets") shared by the magnitude and year range
 * filters. Supports press-and-hold to repeat-step, since a single-step tap
 * alone would make the year filter's 872-2023 span impractical to
 * traverse (see `config.ts`'s `CATALOG_YEAR_STEP` doc comment).
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
  testID,
}: NumericStepperProps) {
  const { colors, typography, spacing } = useTheme();
  // Text being typed; null while the box is not being edited (then it shows
  // the formatted value).
  const [draft, setDraft] = useState<string | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
      if (holdInterval.current) clearInterval(holdInterval.current);
    };
  }, []);

  function clamp(next: number): number {
    return Math.min(max, Math.max(min, Math.round(next * 100) / 100));
  }

  function step_(direction: 1 | -1) {
    onChange(clamp(value + direction * step));
  }

  function startHold(direction: 1 | -1) {
    step_(direction);
    holdTimer.current = setTimeout(() => {
      holdInterval.current = setInterval(() => step_(direction), HOLD_REPEAT_INTERVAL_MS);
    }, HOLD_REPEAT_START_DELAY_MS);
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

  return (
    <View style={[styles.container, { gap: spacing[1] }]}>
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.labelCaption.fontSize,
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
          style={[styles.button, { opacity: value <= min ? 0.4 : 1 }]}
        >
          <Text style={{ color: colors.text.primary, fontSize: typography.h3.fontSize }}>
            −
          </Text>
        </Pressable>
        <TextInput
          testID={testID}
          accessibilityLabel={label}
          allowFontScaling
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
            },
          ]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={incrementA11yLabel}
          disabled={value >= max}
          onPressIn={() => startHold(1)}
          onPressOut={endHold}
          style={[styles.button, { opacity: value >= max ? 0.4 : 1 }]}
        >
          <Text style={{ color: colors.text.primary, fontSize: typography.h3.fontSize }}>
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
