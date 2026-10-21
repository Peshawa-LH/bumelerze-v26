import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { DAMAGE_ARTWORK, LEVEL_ARTWORK } from "@/features/felt";
import { useTheme, nativeFontFamily, READING_START } from "@/theme";
import type { ContributionRowViewModel } from "../format";

interface ContributionRowProps {
  row: ContributionRowViewModel;
  /** Shows "Withdraw" (review note 10.1) when given and the row allows it. */
  onWithdraw?: () => void;
}

/**
 * One My Data list row (D26 item 7 brief): date, event (if the report
 * is attached to one), felt level with its artwork thumbnail, damage grade
 * with its own thumbnail when window 2 was answered, and sync status.
 * The one action on a past contribution is "Withdraw" (review note 10.1;
 * never "Delete": the server keeps the row, it just stops counting it),
 * shown when the list passes `onWithdraw`. No re-open or edit.
 */
export function ContributionRow({ row, onWithdraw }: ContributionRowProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[3],
          gap: spacing[2],
        },
      ]}
    >
      <View style={styles.topRow}>
        <Text
          style={{
            color: colors.text.secondary,
            fontSize: typography.labelCaption.fontSize,
            fontFamily: nativeFontFamily(typography.labelCaption, "400"),
            ...READING_START,
            lineHeight: typography.labelCaption.lineHeight,
          }}
        >
          {row.dateText}
        </Text>
        <Text
          style={{
            color:
              row.syncStatus === "submitted" ? colors.status.success : colors.text.tertiary,
            fontSize: typography.labelCaption.fontSize,
            fontFamily: nativeFontFamily(typography.labelCaption, "600"),
            ...READING_START,
            lineHeight: typography.labelCaption.lineHeight,
            fontWeight: "600",
          }}
        >
          {row.syncStatusText}
        </Text>
      </View>

      <Text
        style={{
          color: colors.text.primary,
          fontSize: typography.bodyDefault.fontSize,
          fontFamily: nativeFontFamily(typography.bodyDefault, "600"),
          ...READING_START,
          lineHeight: typography.bodyDefault.lineHeight,
          fontWeight: "600",
        }}
      >
        {row.eventLabel ?? t("myData.unassignedEvent")}
      </Text>

      <View style={[styles.itemRow, { gap: spacing[2] }]}>
        <Image
          testID="mydata-level-artwork"
          source={LEVEL_ARTWORK[row.level]}
          contentFit="cover"
          style={styles.thumb}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        <Text
          allowFontScaling
          style={{
            flex: 1,
            color: colors.text.primary,
            fontSize: typography.bodyMeta.fontSize,
            fontFamily: nativeFontFamily(typography.bodyMeta),
            ...READING_START,
            lineHeight: typography.bodyMeta.lineHeight,
          }}
        >
          {row.levelLabel}
        </Text>
      </View>

      {row.damage ? (
        <View style={[styles.itemRow, { gap: spacing[2] }]}>
          <Image
            testID="mydata-damage-artwork"
            source={DAMAGE_ARTWORK[row.damage.typology][row.damage.grade]}
            contentFit="cover"
            style={styles.thumb}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
          <Text
            allowFontScaling
            style={{
              flex: 1,
              color: colors.text.secondary,
              fontSize: typography.bodyMeta.fontSize,
              fontFamily: nativeFontFamily(typography.bodyMeta),
              ...READING_START,
              lineHeight: typography.bodyMeta.lineHeight,
            }}
          >
            {t("myData.damageLine", {
              typology: row.damage.typologyLabel,
              grade: row.damage.label,
            })}
          </Text>
        </View>
      ) : null}

      {row.hasPhoto ? (
        <Text
          style={{
            color: colors.text.tertiary,
            fontSize: typography.labelCaption.fontSize,
            fontFamily: nativeFontFamily(typography.labelCaption, "400"),
            ...READING_START,
            lineHeight: typography.labelCaption.lineHeight,
          }}
        >
          {t("myData.photoAttachedLabel")}
        </Text>
      ) : null}

      {onWithdraw && row.canWithdraw ? (
        <Pressable
          testID={`withdraw-${row.reportId}`}
          accessibilityRole="button"
          accessibilityLabel={t("myData.withdraw.a11y", { date: row.dateText })}
          onPress={onWithdraw}
          hitSlop={8}
          style={styles.withdraw}
        >
          <Text
            style={{
              color: colors.text.link,
              fontSize: typography.labelButton.fontSize,
              fontFamily: nativeFontFamily(typography.labelButton),
              ...READING_START,
              lineHeight: typography.labelButton.lineHeight,
              fontWeight: typography.labelButton.fontWeight,
            }}
          >
            {t("myData.withdraw.action")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  thumb: {
    width: 40,
    height: 40,
    borderRadius: 8,
  },
  withdraw: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center" },
});
