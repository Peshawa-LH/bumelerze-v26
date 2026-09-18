import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { TranslateFn } from "@/features/geo";
import { localizeDigits } from "@/lib/format-numbers";
import type { Theme } from "@/theme";
import type { RiskAreaLevel, RiskAreas } from "../types";
import { RiskAreaRow } from "./RiskAreaRow";

export interface RiskAreaListProps {
  areas: RiskAreas;
  locale: string;
  t: TranslateFn;
  colors: Theme["colors"];
  typography: Theme["typography"];
  spacing: Theme["spacing"];
}

/** First page before "Show all" is tapped — same cutoff `RiskProvinceList`
 * uses for its own single-level list. */
const INITIAL_ROWS = 6;

/** Fixed switch order, most locally meaningful first (owner: someone
 * checking the app after a shake cares about their own city/neighbourhood
 * before the province-wide number) — deliberately the REVERSE of
 * `risk.ts`'s `RISK_AREA_LEVELS` parsing order (that one is
 * coarsest-first, matching the producer's own `levels` object key order;
 * this one is a presentation choice, kept local to this component rather
 * than exported, since nothing else needs it). */
const LEVEL_SWITCH_ORDER: readonly RiskAreaLevel[] = ["city", "subdistrict", "district", "governorate"];

/** Default level: city when the event's city list is non-empty (the
 * common, most granular case), otherwise district (owner: "district is the
 * next-most useful level when GHS has no urban centre in the shaken area
 * at all") — falling further back to the first level that actually has
 * rows only for the pathological case where neither city nor district is
 * populated. */
function pickDefaultLevel(
  areas: RiskAreas,
  visibleLevels: readonly RiskAreaLevel[],
): RiskAreaLevel {
  if (areas.levels.city.length > 0) {
    return "city";
  }
  if (visibleLevels.includes("district")) {
    return "district";
  }
  return visibleLevels[0] ?? "district";
}

/**
 * Ranked, level-switchable list of the most-affected areas — the
 * `areas.json`/`risk-areas`-wave replacement for `RiskProvinceList` on any
 * event whose risk product carries the finer-grained product (`RiskSection`
 * decides which of the two to render; this component never checks
 * `damageModel`/`nDraws` itself, only the four level arrays it was handed).
 * A segmented level switch (cities / sub-districts / districts /
 * governorates, only the non-empty ones shown, same
 * `accessibilityRole="tablist"`/`"tab"` pattern `ShakeMapLayerToggle`
 * already establishes for a segmented control in this codebase) sits above
 * one `RiskAreaRow` per area, worst-first (each level's own producer
 * order, never re-sorted), 6 shown up front with a "Show all (N)" toggle —
 * switching level resets that toggle back to the first 6 of the newly
 * selected level.
 */
export function RiskAreaList({ areas, locale, t, colors, typography, spacing }: RiskAreaListProps) {
  const visibleLevels = useMemo(
    () => LEVEL_SWITCH_ORDER.filter((level) => areas.levels[level].length > 0),
    [areas],
  );
  const [level, setLevel] = useState<RiskAreaLevel>(() => pickDefaultLevel(areas, visibleLevels));
  const [showAll, setShowAll] = useState(false);

  if (visibleLevels.length === 0) {
    return null;
  }

  // Guards a level selected before `areas` changed out from under this
  // component (e.g. a different event's product resolving in) — falls
  // back to the first visible level rather than rendering an empty list.
  const activeLevel = areas.levels[level].length > 0 ? level : (visibleLevels[0] as RiskAreaLevel);
  const rows = areas.levels[activeLevel];

  const worstBuildingsHeavy = rows[0]?.buildingsHeavy ?? 0;
  const visible = showAll ? rows : rows.slice(0, INITIAL_ROWS);
  const hasMore = rows.length > INITIAL_ROWS;

  function selectLevel(next: RiskAreaLevel) {
    setLevel(next);
    setShowAll(false);
  }

  return (
    <View style={{ gap: spacing[2] }}>
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.labelCaption.fontSize,
          lineHeight: typography.labelCaption.lineHeight,
          fontWeight: typography.labelCaption.fontWeight,
        }}
      >
        {t("eventDetail.risk.areasTitle")}
      </Text>

      {visibleLevels.length > 1 ? (
        <View style={[styles.levelRow, { gap: spacing[1] }]} accessibilityRole="tablist">
          {visibleLevels.map((option) => {
            const selected = option === activeLevel;
            return (
              <Pressable
                key={option}
                testID={`risk-area-level-${option}`}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={t("eventDetail.risk.areaLevelA11y", {
                  level: t(`eventDetail.risk.areaLevels.${option}`),
                })}
                onPress={() => selectLevel(option)}
                hitSlop={8}
                style={[
                  styles.levelOption,
                  {
                    backgroundColor: selected ? colors.brand.primary : colors.surface.sunken,
                    borderRadius: 8,
                    paddingVertical: spacing[1],
                    paddingHorizontal: spacing[3],
                  },
                ]}
              >
                <Text
                  style={{
                    color: selected ? colors.brand.onPrimary : colors.text.secondary,
                    fontSize: typography.labelCaption.fontSize,
                    lineHeight: typography.labelCaption.lineHeight,
                    fontWeight: "600",
                  }}
                >
                  {t(`eventDetail.risk.areaLevels.${option}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <View style={{ gap: spacing[2] }}>
        {visible.map((area) => (
          <RiskAreaRow
            key={area.id}
            area={area}
            worstBuildingsHeavy={worstBuildingsHeavy}
            locale={locale}
            t={t}
            colors={colors}
            typography={typography}
            spacing={spacing}
          />
        ))}
      </View>

      {hasMore ? (
        <Pressable
          testID="risk-areas-show-all"
          accessibilityRole="button"
          onPress={() => setShowAll((prev) => !prev)}
          hitSlop={12}
          style={styles.toggle}
        >
          <Text
            style={{
              color: colors.text.link,
              fontSize: typography.bodyMeta.fontSize,
              fontWeight: "600",
            }}
          >
            {showAll
              ? t("eventDetail.risk.showFewer")
              : t("eventDetail.risk.showAll", { count: localizeDigits(String(rows.length), locale) })}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  levelRow: {
    flexDirection: "row",
    alignSelf: "flex-start",
  },
  levelOption: {
    alignItems: "center",
  },
  toggle: {
    alignSelf: "flex-start",
  },
});
