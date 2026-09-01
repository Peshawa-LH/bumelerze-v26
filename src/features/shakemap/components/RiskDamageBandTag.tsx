import { StyleSheet, Text, View } from "react-native";

import type { TranslateFn } from "@/features/geo";
import type { Theme } from "@/theme";
import type { DamageBand } from "../risk-alert";

export interface RiskDamageBandTagProps {
  band: DamageBand;
  t: TranslateFn;
  colors: Theme["colors"];
  typography: Theme["typography"];
  spacing: Theme["spacing"];
}

/** Band -> theme color token, resolved fresh from `colors` every render
 * (never a hardcoded hex) — green/yellow/red map onto the app's existing
 * status ramp; orange has no `status.*` equivalent, so it borrows DG4 from
 * the damage-grade ramp (`theme/palette.ts`), the same "orange" swatch
 * `RiskDamageGradeBar`'s own severe segment is built from. */
export function damageBandColor(band: DamageBand, colors: Theme["colors"]): string {
  switch (band) {
    case "green":
      return colors.status.success;
    case "yellow":
      return colors.status.warning;
    case "orange":
      return colors.damageGrade[4] ?? colors.status.warning;
    case "red":
      return colors.status.danger;
    default:
      return colors.status.info;
  }
}

/**
 * The damage-alert band pill (owner's PAGER-style ask, redrawn in
 * Bumelerze's own visual language per the follow-up correction — a card
 * with a small colored square swatch, not PAGER's full-width colored
 * banner). Classified from `RiskSummary.buildingsHeavyP05P50P95`'s P50
 * (`risk-alert.ts`'s `classifyDamageBand`) — building damage only, never
 * casualties (D45; this component has no fatality field to read even if
 * it wanted to).
 */
export function RiskDamageBandTag({ band, t, colors, typography, spacing }: RiskDamageBandTagProps) {
  const title = t(`eventDetail.risk.band.${band}.title`);
  const sentence = t(`eventDetail.risk.band.${band}.sentence`);

  return (
    <View
      testID="risk-damage-band-tag"
      accessible
      accessibilityLabel={`${title}. ${sentence}`}
      style={[
        styles.card,
        { backgroundColor: colors.surface.raised, padding: spacing[4], gap: spacing[3] },
      ]}
    >
      <View
        testID="risk-damage-band-swatch"
        style={[styles.swatch, { backgroundColor: damageBandColor(band, colors) }]}
      />
      <View style={{ gap: spacing[1], flexShrink: 1 }}>
        <Text
          style={{
            color: colors.text.primary,
            fontSize: typography.h3.fontSize,
            lineHeight: typography.h3.lineHeight,
            fontWeight: typography.h3.fontWeight,
          }}
        >
          {title}
        </Text>
        <Text
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyMeta.fontSize,
            lineHeight: typography.bodyMeta.lineHeight,
          }}
        >
          {sentence}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
  },
  swatch: {
    width: 14,
    height: 14,
    borderRadius: 4,
  },
});
