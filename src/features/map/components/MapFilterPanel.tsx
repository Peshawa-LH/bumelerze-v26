import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import {
  formatDateOnly,
  formatMagnitudeValue,
  isolateNumeric,
} from "@/features/events";
import { isRTLLocale } from "@/i18n";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";
import {
  isDateRangeNarrowed,
  isMagnitudeRangeNarrowed,
  type DateRangeMs,
  type MagnitudeRange,
} from "../filters";

interface MapFilterPanelProps {
  magnitudeBounds: MagnitudeRange;
  magnitudeRange: MagnitudeRange;
  onMagnitudeRangeChange: (range: MagnitudeRange) => void;
  dateBounds: DateRangeMs;
  dateRange: DateRangeMs;
  onDateRangeChange: (range: DateRangeMs) => void;
  onReset: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const MAGNITUDE_STEP = 0.1;

/**
 * DOM-only component (raw `<input type="range">`, not an RN primitive) —
 * safe here because this module is only ever reachable through
 * `map.web.tsx`'s own import graph (see that file's doc comment on why
 * Metro never even loads it for native), the same reasoning that already
 * lets `map.web.tsx` itself use a raw `<div>` for the MapLibre container.
 * Two overlapping native range inputs per row (min/max) is the standard
 * accessible two-handle-slider pattern — each is independently focusable/
 * labelled and gets full native keyboard support for free, which a
 * hand-rolled PanResponder/Reanimated slider would have to reimplement from
 * scratch (and this app has no `@react-native-community/slider` dependency
 * to reach for instead — adding one for a web-only control isn't worth a
 * new native dependency the owner can't debug, per PROJECT.md's "boring,
 * well-documented" preference).
 *
 * RTL note: `dir` is set explicitly from `isRTLLocale(locale)` rather than
 * relying on `I18nManager.isRTL` — react-native-web's own `I18nManager` is a
 * stub that always reports `false` (see `EventCard.tsx`'s identical
 * finding). Native `<input type="range">` RTL mirroring is a genuine,
 * documented web-platform inconsistency across browsers even with `dir`
 * set correctly — this is a best-effort visual mirror, not a guarantee;
 * the numeric labels above each handle (always logically ordered
 * min→max regardless of visual mirroring) are what actually carries the
 * correct information in every browser.
 */
export function MapFilterPanel({
  magnitudeBounds,
  magnitudeRange,
  onMagnitudeRangeChange,
  dateBounds,
  dateRange,
  onDateRangeChange,
  onReset,
  expanded,
  onToggleExpanded,
}: MapFilterPanelProps) {
  const { t, i18n } = useTranslation();
  const { colors, spacing, typography } = useTheme();
  const locale = i18n.language;
  const dir = isRTLLocale(locale) ? "rtl" : "ltr";

  const magnitudeNarrowed = isMagnitudeRangeNarrowed(magnitudeRange, magnitudeBounds);
  const dateNarrowed = isDateRangeNarrowed(dateRange, dateBounds);
  const isFiltered = magnitudeNarrowed || dateNarrowed;

  const spanDays = Math.max(
    1,
    Math.round((dateRange.endMs - dateRange.startMs) / ONE_DAY_MS),
  );
  const summary = t(dateNarrowed ? "map.filters.summary" : "map.filters.summaryAllTime", {
    magMin: formatMagnitudeValue(magnitudeRange.min, locale),
    magMax: formatMagnitudeValue(magnitudeRange.max, locale),
    days: localizeDigits(String(spanDays), locale),
  });

  function handleMagnitudeMinChange(rawValue: number): void {
    const min = Math.min(rawValue, magnitudeRange.max);
    onMagnitudeRangeChange({ min, max: magnitudeRange.max });
  }

  function handleMagnitudeMaxChange(rawValue: number): void {
    const max = Math.max(rawValue, magnitudeRange.min);
    onMagnitudeRangeChange({ min: magnitudeRange.min, max });
  }

  function handleDateStartChange(rawValue: number): void {
    const startMs = Math.min(rawValue, dateRange.endMs);
    onDateRangeChange({ startMs, endMs: dateRange.endMs });
  }

  function handleDateEndChange(rawValue: number): void {
    const endMs = Math.max(rawValue, dateRange.startMs);
    onDateRangeChange({ startMs: dateRange.startMs, endMs });
  }

  return (
    <View
      style={[
        styles.container,
        { borderColor: colors.border.default, backgroundColor: colors.surface.raised },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={t(
          expanded ? "map.filters.collapseA11yHint" : "map.filters.expandA11yHint",
        )}
        onPress={onToggleExpanded}
        hitSlop={6}
        style={[styles.header, { padding: spacing[2], gap: spacing[2] }]}
      >
        <Ionicons name="options-outline" size={16} color={colors.text.primary} />
        <Text
          allowFontScaling
          numberOfLines={1}
          style={{
            flexShrink: 1,
            color: colors.text.primary,
            fontSize: typography.bodyMeta.fontSize,
            lineHeight: typography.bodyMeta.lineHeight,
            fontWeight: "600",
          }}
        >
          {expanded ? t("map.filters.title") : isolateNumeric(summary)}
        </Text>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={16}
          color={colors.text.secondary}
        />
      </Pressable>

      {expanded ? (
        <View style={{ padding: spacing[3], paddingTop: 0, gap: spacing[4] }}>
          <View style={{ gap: spacing[1] }}>
            <View style={styles.rowBetween}>
              <Text
                style={{
                  color: colors.text.secondary,
                  fontSize: typography.labelCaption.fontSize,
                  lineHeight: typography.labelCaption.lineHeight,
                }}
              >
                {t("map.filters.magnitudeLabel")}
              </Text>
              <Text
                style={{
                  color: colors.text.primary,
                  fontSize: typography.labelCaption.fontSize,
                  lineHeight: typography.labelCaption.lineHeight,
                  fontWeight: "600",
                }}
              >
                {isolateNumeric(
                  t("map.filters.magnitudeRangeValue", {
                    min: formatMagnitudeValue(magnitudeRange.min, locale),
                    max: formatMagnitudeValue(magnitudeRange.max, locale),
                  }),
                )}
              </Text>
            </View>
            <input
              type="range"
              dir={dir}
              aria-label={t("map.filters.magnitudeMinA11yLabel")}
              min={magnitudeBounds.min}
              max={magnitudeBounds.max}
              step={MAGNITUDE_STEP}
              value={magnitudeRange.min}
              onChange={(event) => handleMagnitudeMinChange(Number(event.target.value))}
              style={rangeInputStyle}
            />
            <input
              type="range"
              dir={dir}
              aria-label={t("map.filters.magnitudeMaxA11yLabel")}
              min={magnitudeBounds.min}
              max={magnitudeBounds.max}
              step={MAGNITUDE_STEP}
              value={magnitudeRange.max}
              onChange={(event) => handleMagnitudeMaxChange(Number(event.target.value))}
              style={rangeInputStyle}
            />
          </View>

          <View style={{ gap: spacing[1] }}>
            <View style={styles.rowBetween}>
              <Text
                style={{
                  color: colors.text.secondary,
                  fontSize: typography.labelCaption.fontSize,
                  lineHeight: typography.labelCaption.lineHeight,
                }}
              >
                {t("map.filters.dateLabel")}
              </Text>
              <Text
                numberOfLines={1}
                style={{
                  color: colors.text.primary,
                  fontSize: typography.labelCaption.fontSize,
                  lineHeight: typography.labelCaption.lineHeight,
                  fontWeight: "600",
                }}
              >
                {isolateNumeric(
                  t("map.filters.dateRangeValue", {
                    start: formatDateOnly(dateRange.startMs, locale, t),
                    end: formatDateOnly(dateRange.endMs, locale, t),
                  }),
                )}
              </Text>
            </View>
            <input
              type="range"
              dir={dir}
              aria-label={t("map.filters.dateMinA11yLabel")}
              min={dateBounds.startMs}
              max={dateBounds.endMs}
              step={ONE_HOUR_MS}
              value={dateRange.startMs}
              onChange={(event) => handleDateStartChange(Number(event.target.value))}
              style={rangeInputStyle}
            />
            <input
              type="range"
              dir={dir}
              aria-label={t("map.filters.dateMaxA11yLabel")}
              min={dateBounds.startMs}
              max={dateBounds.endMs}
              step={ONE_HOUR_MS}
              value={dateRange.endMs}
              onChange={(event) => handleDateEndChange(Number(event.target.value))}
              style={rangeInputStyle}
            />
          </View>

          <Pressable
            accessibilityRole="button"
            // Explicit label (not left to implicit icon+text child
            // computation) — the adjacent `Ionicons` glyph is itself a real,
            // non-empty accessible-text character (icon fonts render one
            // Unicode codepoint per icon), which would otherwise prefix the
            // computed name with a stray glyph before "Reset". Same pattern
            // `AccessibilityDisclosure.tsx` already uses for its own
            // icon+text toggle.
            accessibilityLabel={t("map.filters.reset")}
            accessibilityState={{ disabled: !isFiltered }}
            disabled={!isFiltered}
            onPress={onReset}
            hitSlop={8}
            style={[styles.resetButton, { opacity: isFiltered ? 1 : 0.4 }]}
          >
            <Ionicons name="refresh-outline" size={14} color={colors.text.link} />
            <Text
              style={{
                color: colors.text.link,
                fontSize: typography.labelCaption.fontSize,
                fontWeight: "600",
              }}
            >
              {t("map.filters.reset")}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

// A plain object (not `StyleSheet.create`, same reasoning as
// `map.web.tsx`'s `mapContainerStyle`) — a raw DOM `<input>` needs a plain
// CSS-shaped style object, not an RN `StyleSheet` id.
const rangeInputStyle: Record<string, string> = {
  width: "100%",
  height: "24px",
};

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
    maxWidth: 280,
    minWidth: 220,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 40,
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  resetButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    minHeight: 32,
  },
});
