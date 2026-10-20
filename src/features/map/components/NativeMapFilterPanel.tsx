import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { formatDateOnly, formatMagnitudeValue, isolateNumeric } from "@/features/events";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme, READING_START } from "@/theme";
import {
  isDateRangeNarrowed,
  isMagnitudeRangeNarrowed,
  type DateRangeMs,
  type MagnitudeRange,
} from "../filters";
import { MapControlIconButton } from "./MapControlIconButton";
import { NativeRangeSlider } from "./NativeRangeSlider";

interface NativeMapFilterPanelProps {
  magnitudeBounds: MagnitudeRange;
  magnitudeRange: MagnitudeRange;
  onMagnitudeRangeChange: (range: MagnitudeRange) => void;
  dateBounds: DateRangeMs;
  dateRange: DateRangeMs;
  onDateRangeChange: (range: DateRangeMs) => void;
  onReset: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  compact?: boolean;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const MAGNITUDE_STEP = 0.1;

/**
 * The native Map tab's magnitude and date filters: the web's
 * `MapFilterPanel` (same header, summary, labels, value read-outs, Reset,
 * compact icon and popover) with a two-thumb `NativeRangeSlider` per row
 * in place of the web's two DOM range inputs, which React Native cannot
 * render. Same steps as the web: 0.1 magnitude, one hour; VoiceOver moves
 * the date thumbs a day at a time.
 */
export function NativeMapFilterPanel({
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
}: NativeMapFilterPanelProps) {
  const { t, i18n } = useTranslation();
  const { colors, spacing, typography } = useTheme();
  const locale = i18n.language;

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

  const collapsedIconA11yLabel = isFiltered
    ? [t("map.filters.expandA11yHint"), isolateNumeric(summary)].join(". ")
    : t("map.filters.expandA11yHint");

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

  const caption = {
    color: colors.text.secondary,
    fontSize: typography.labelCaption.fontSize,
    lineHeight: typography.labelCaption.lineHeight,
    fontFamily: typography.labelCaption.fontFamily,
  } as const;
  const value = {
    ...caption,
    color: colors.text.primary,
    fontWeight: "600",
  } as const;

  return (
    <View
      testID="native-map-filters"
      style={[
        styles.container,
        { borderColor: colors.border.default, backgroundColor: colors.surface.raised },
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
            fontFamily: typography.bodyMeta.fontFamily,
            ...READING_START,
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
        <View style={{ padding: spacing[3], paddingTop: 0, gap: spacing[3] }}>
          <View>
            <View style={styles.rowBetween}>
              <Text style={caption}>{t("map.filters.magnitudeLabel")}</Text>
              <Text style={value}>
                {isolateNumeric(
                  t("map.filters.magnitudeRangeValue", {
                    min: formatMagnitudeValue(magnitudeRange.min, locale),
                    max: formatMagnitudeValue(magnitudeRange.max, locale),
                  }),
                )}
              </Text>
            </View>
            <NativeRangeSlider
              testID="native-map-filters-magnitude"
              min={magnitudeBounds.min}
              max={magnitudeBounds.max}
              step={MAGNITUDE_STEP}
              low={magnitudeRange.min}
              high={magnitudeRange.max}
              onChange={({ low, high }) =>
                onMagnitudeRangeChange({ min: low, max: high })
              }
              lowLabel={t("map.filters.magnitudeMinA11yLabel")}
              highLabel={t("map.filters.magnitudeMaxA11yLabel")}
              formatValue={(v) => formatMagnitudeValue(v, locale)}
            />
          </View>

          <View>
            <View style={styles.rowBetween}>
              <Text style={caption}>{t("map.filters.dateLabel")}</Text>
              <Text numberOfLines={1} style={[value, styles.shrink]}>
                {isolateNumeric(
                  t("map.filters.dateRangeValue", {
                    start: formatDateOnly(dateRange.startMs, locale, t),
                    end: formatDateOnly(dateRange.endMs, locale, t),
                  }),
                )}
              </Text>
            </View>
            <NativeRangeSlider
              testID="native-map-filters-date"
              min={dateBounds.startMs}
              max={dateBounds.endMs}
              step={ONE_HOUR_MS}
              accessibilityStep={ONE_DAY_MS}
              low={dateRange.startMs}
              high={dateRange.endMs}
              onChange={({ low, high }) =>
                onDateRangeChange({ startMs: low, endMs: high })
              }
              lowLabel={t("map.filters.dateMinA11yLabel")}
              highLabel={t("map.filters.dateMaxA11yLabel")}
              formatValue={(v) => formatDateOnly(v, locale, t)}
            />
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("map.filters.reset")}
            accessibilityState={{ disabled: !isFiltered }}
            disabled={!isFiltered}
            onPress={onReset}
            style={[styles.resetButton, { opacity: isFiltered ? 1 : 0.4 }]}
          >
            <Ionicons name="refresh-outline" size={14} color={colors.text.link} />
            <Text
              style={{
                color: colors.text.link,
                fontSize: typography.labelCaption.fontSize,
                fontFamily: typography.labelCaption.fontFamily,
                ...READING_START,
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
    minHeight: 44,
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  shrink: {
    flexShrink: 1,
  },
  resetButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    minHeight: 44,
  },
  popover: {
    position: "absolute",
    top: "100%",
    end: 0,
    minWidth: 260,
    zIndex: 30,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
