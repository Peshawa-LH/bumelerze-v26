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
import { MapControlIconButton } from "./MapControlIconButton";

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
  /** Collapses the HEADER to a `MapControlIconButton` and renders the body
   * as a floating popover instead of an inline block — the phone-width
   * default (`responsive.ts`). `false` (the pre-existing behavior, unit
   * tests' implicit default at jsdom's 1024px width) keeps today's
   * always-legible header bar + inline-expanding body untouched. */
  compact?: boolean;
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
  compact = false,
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

  // The COMPACT collapsed icon button's accessible name — same base hint
  // text as the non-compact header (`expandA11yHint`, unchanged from
  // before this wave) with the live summary appended when a filter is
  // actually active, so a screen-reader user gets the "active" state
  // that's otherwise only conveyed visually (`MapControlIconButton`'s
  // badge dot) without a whole second set of translated strings — reuses
  // the SAME `join(". ")` composition already established for marker
  // labels in `map.web.tsx`.
  const collapsedIconA11yLabel = isFiltered
    ? [t("map.filters.expandA11yHint"), isolateNumeric(summary)].join(". ")
    : t("map.filters.expandA11yHint");

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

  // Collapsed + compact: just the round icon button (Problem 1) — the
  // full header/body below only renders once expanded, or at any width
  // that isn't compact (today's always-legible bar, unchanged).
  if (compact && !expanded) {
    return (
      <MapControlIconButton
        icon="options-outline"
        isActive={isFiltered}
        accessibilityLabel={collapsedIconA11yLabel}
        onPress={onToggleExpanded}
      />
    );
  }

  return (
    <View
      style={[
        styles.container,
        { borderColor: colors.border.default, backgroundColor: colors.surface.raised },
        // Compact + expanded: floats as a popover below the controls row
        // instead of pushing the OTHER icon button out of the way — see
        // this component's own header Pressable (unchanged) for the
        // collapse affordance once open.
        compact && [styles.popover, { marginTop: spacing[2] }],
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
  // Compact-expanded popover — absolutely positioned against the nearest
  // positioned ancestor (`map.web.tsx`'s `controlsColumn`, an ordinary View
  // and therefore already a valid `position: relative` context by RN's own
  // default), so opening this panel never reflows the sibling style-picker
  // icon button next to it. `end: 0` (logical, RTL-safe) keeps it hugging
  // the same edge the collapsed icon row is anchored to, so it stays
  // within a narrow viewport instead of overflowing past the screen edge.
  popover: {
    position: "absolute",
    top: "100%",
    end: 0,
    zIndex: 30,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
