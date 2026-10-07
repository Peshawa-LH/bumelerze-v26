import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { DonutChart, type DonutSlice } from "@/components/DonutChart";
import { useTheme } from "@/theme";

import { StaticPill } from "../StaticPill";

const HUB_PILL_WIDTH = 152;
/** Made-up shares of "what people felt", by felt level. */
const SAMPLE_SHARES: readonly { level: number; value: number }[] = [
  { level: 3, value: 14 },
  { level: 4, value: 9 },
  { level: 5, value: 4 },
];

/** Event hub: the "Who felt it?" pill, a small felt donut and a comment row. */
export function HubPreview() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const slices: DonutSlice[] = SAMPLE_SHARES.map(({ level, value }) => ({
    key: `level-${level}`,
    value,
    color: colors.intensity[level] ?? colors.surface.sunken,
    label: t(`felt.tier1.levels.${level}.label`),
  }));
  return (
    <View style={{ gap: spacing[4] }}>
      <StaticPill
        label={t("eventHub.pill.label")}
        tone="brand"
        minWidth={HUB_PILL_WIDTH}
      />
      <DonutChart slices={slices} size={96} maxLegendRows={3} />
      {/* One comment as a drawing: an avatar and two lines. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[3],
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          borderWidth: 1,
          borderRadius: 12,
          padding: spacing[3],
        }}
      >
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: colors.brand.primary,
          }}
        />
        <View style={{ flex: 1, gap: spacing[2] }}>
          <View
            style={{
              height: 8,
              width: "45%",
              borderRadius: 4,
              backgroundColor: colors.border.default,
            }}
          />
          <View
            style={{
              height: 8,
              width: "85%",
              borderRadius: 4,
              backgroundColor: colors.border.subtle,
            }}
          />
        </View>
      </View>
    </View>
  );
}
