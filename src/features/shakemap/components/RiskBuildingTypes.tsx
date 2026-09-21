import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { TranslateFn } from "@/features/geo";
import { formatApproximate, localizeDigits } from "@/lib/format-numbers";
import type { Theme } from "@/theme";

import type { RiskBuildingTypeDamage, RiskTypeCatalog } from "../types";

export interface RiskBuildingTypesProps {
  types: readonly RiskBuildingTypeDamage[];
  catalog: RiskTypeCatalog;
  locale: string;
  t: TranslateFn;
  colors: Theme["colors"];
  typography: Theme["typography"];
  spacing: Theme["spacing"];
}

/** Rows shown before the reader asks for the rest. The product carries
 * all 26 IMS-25 types nationally; a phone screen does not. */
const INITIAL_ROWS = 6;

/** A type with no damage at all is not informative here, only long. */
const MIN_HEAVY = 1;

/** A share is only a statement about a type when there is a type to speak
 * of. Without this a handful of buildings of some rare type could top the
 * list at 100 percent and say nothing at all. */
const MIN_STOCK = 100;

/**
 * Damage by IMS-25 building type: what KIND of building is being damaged,
 * which is the question the 26-type vulnerability model exists to answer
 * and the one no other block on this screen touches.
 *
 * Each row carries the count damaged AND the share of that type's own
 * stock damaged, because the count alone inverts the story. On the 2017
 * Iran-Iraq event manufactured stone with concrete floors has the second
 * highest count of heavy damage in the country, purely because there is
 * so much of it standing, at 0.2 percent of its own stock; rubble-stone
 * masonry sits at 2.5 percent. On counts the first looks like the
 * problem. On shares the second plainly is.
 *
 * The share is therefore the emphasised number and the bar is drawn from
 * it, not from the count.
 */
export function RiskBuildingTypes({
  types,
  catalog,
  locale,
  t,
  colors,
  typography,
  spacing,
}: RiskBuildingTypesProps) {
  const [expanded, setExpanded] = useState(false);

  // Ranked by SHARE, not by count. The producer sorts by count, which
  // answers "where is most of the damage"; this block's title, explainer
  // and bars are all about "which kinds of building are failing", and
  // ordering by one while drawing the other reads as unsorted.
  const rows = types
    .filter((row) => row.buildingsHeavy >= MIN_HEAVY && row.buildings >= MIN_STOCK)
    .slice()
    .sort((a, b) => b.shareHeavy - a.shareHeavy);
  if (rows.length === 0) {
    return null;
  }

  const shown = expanded ? rows : rows.slice(0, INITIAL_ROWS);
  const widestShare = Math.max(...rows.map((row) => row.shareHeavy), 0.0001);

  const caption = {
    color: colors.text.secondary,
    fontSize: typography.labelCaption.fontSize,
    lineHeight: typography.labelCaption.lineHeight,
  } as const;

  return (
    <View style={{ gap: spacing[2] }}>
      <Text style={[caption, { fontWeight: typography.labelCaption.fontWeight }]}>
        {t("eventDetail.risk.buildingTypes.title")}
      </Text>
      <Text style={[caption, { color: colors.text.tertiary }]}>
        {t("eventDetail.risk.buildingTypes.explainer")}
      </Text>

      {shown.map((row) => {
        const meta = catalog[row.code];
        // The percent SIGN's placement is a locale decision (Sorani and
        // Kurmanji put it before the number), so it lives in the i18n
        // string, never in this component.
        const percent = t("eventDetail.risk.buildingTypes.percent", {
          value: localizeDigits(formatShare(row.shareHeavy), locale),
        });
        const count = formatApproximate(row.buildingsHeavy, locale, t);
        // The description comes from the product's own catalog, so a
        // locale without a translation yet shows the producer's text
        // rather than a missing-key placeholder.
        const description = meta
          ? t(`eventDetail.risk.buildingTypes.type.${row.code}`, {
              defaultValue: meta.description,
            })
          : row.code;

        return (
          <View
            key={row.code}
            testID={`risk-building-type-${row.code}`}
            style={{ gap: 4 }}
            accessibilityRole="text"
            accessibilityLabel={t("eventDetail.risk.buildingTypes.a11yRow", {
              type: description,
              percent,
              value: count,
            })}
          >
            <View style={styles.headerRow}>
              <Text
                style={[
                  caption,
                  { color: colors.text.primary, fontWeight: "600", flexShrink: 1 },
                ]}
                numberOfLines={1}
              >
                {description}
              </Text>
              {meta ? (
                <Text style={[caption, { color: colors.text.tertiary }]}>
                  {t("eventDetail.risk.buildingTypes.vulnerabilityClass", {
                    class: meta.vulnerabilityClass,
                  })}
                </Text>
              ) : null}
            </View>

            <View style={styles.barRow}>
              <View style={[styles.track, { backgroundColor: colors.border.subtle }]}>
                <View
                  style={{
                    width: `${Math.max(2, (row.shareHeavy / widestShare) * 100)}%`,
                    height: "100%",
                    borderRadius: 3,
                    backgroundColor: colors.status.warning,
                  }}
                />
              </View>
              <Text style={[caption, { color: colors.text.primary, fontWeight: "600" }]}>
                {percent}
              </Text>
            </View>

            <Text style={[caption, { color: colors.text.tertiary }]}>
              {t("eventDetail.risk.buildingTypes.rowCaption", { value: count })}
            </Text>
          </View>
        );
      })}

      {rows.length > INITIAL_ROWS ? (
        <Pressable
          onPress={() => setExpanded((value) => !value)}
          accessibilityRole="button"
          testID="risk-building-types-toggle"
        >
          <Text style={[caption, { color: colors.text.link }]}>
            {expanded
              ? t("eventDetail.risk.showFewer")
              : t("eventDetail.risk.showAll", { count: rows.length })}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** The bare number, no sign: one decimal below ten percent, none above.
 * "0.2" carries meaning at the bottom of this list; "12.4" does not need
 * the decimal at the top. The sign is added by the i18n string. */
function formatShare(share: number): string {
  const percent = share * 100;
  return percent >= 10 ? String(Math.round(percent)) : percent.toFixed(1);
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  barRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  track: { flex: 1, height: 6, borderRadius: 3, overflow: "hidden" },
});
