import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { TranslateFn } from "@/features/geo";
import { localizeDigits } from "@/lib/format-numbers";
import type { Theme } from "@/theme";
import type { RiskDistrict } from "../types";
import { RiskProvinceRow } from "./RiskProvinceRow";

export interface RiskProvinceListProps {
  districts: readonly RiskDistrict[];
  locale: string;
  t: TranslateFn;
  colors: Theme["colors"];
  typography: Theme["typography"];
  spacing: Theme["spacing"];
}

/** First page before "Show all" is tapped. */
const INITIAL_ROWS = 6;

/**
 * Ranked list of the most-affected provinces — worst-first (already the
 * producer's own order, `RiskDistricts.districts`'s own doc comment; never
 * re-sorted), one `RiskProvinceRow` per province, 6 shown up front with a
 * "Show all (N)" toggle.
 */
export function RiskProvinceList({
  districts,
  locale,
  t,
  colors,
  typography,
  spacing,
}: RiskProvinceListProps) {
  const [showAll, setShowAll] = useState(false);

  if (districts.length === 0) {
    return null;
  }

  const worstBuildingsHeavy = districts[0]?.buildingsHeavy ?? 0;
  const visible = showAll ? districts : districts.slice(0, INITIAL_ROWS);
  const hasMore = districts.length > INITIAL_ROWS;

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
        {t("eventDetail.risk.provincesTitle")}
      </Text>
      <View style={{ gap: spacing[2] }}>
        {visible.map((district) => (
          <RiskProvinceRow
            key={district.adm1Id}
            district={district}
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
          testID="risk-provinces-show-all"
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
              : t("eventDetail.risk.showAll", { count: localizeDigits(String(districts.length), locale) })}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: {
    alignSelf: "flex-start",
  },
});
