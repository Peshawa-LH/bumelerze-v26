import { useRouter } from "expo-router";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AccountButton } from "@/features/account/components/AccountButton";
import { directionProps } from "@/i18n";
import { nativeFontFamily, READING_START, useTheme } from "@/theme";

/**
 * "Earthquake removed" (wording 2.22): what a link to an earthquake that
 * Bumelerze hid as not real (or for another reason) opens, for everyone but
 * admins (migration 0085). A link to a hidden second card opens the card
 * that stays instead; an id nobody knows keeps "Event not found".
 */
export function EarthquakeRemoved({
  testID = "earthquake-removed",
}: {
  testID?: string;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();
  const dir = directionProps(i18n.language);
  return (
    <View testID={testID} style={{ gap: spacing[3] }}>
      <Text
        {...dir}
        accessibilityRole="header"
        style={{
          color: colors.text.primary,
          fontSize: typography.h2.fontSize,
          fontFamily: nativeFontFamily(typography.h2),
          ...READING_START,
          lineHeight: typography.h2.lineHeight,
          fontWeight: typography.h2.fontWeight,
        }}
      >
        {t("eventDetail.removedTitle")}
      </Text>
      <Text
        {...dir}
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyDefault.fontSize,
          fontFamily: nativeFontFamily(typography.bodyDefault),
          ...READING_START,
          lineHeight: typography.bodyDefault.lineHeight,
        }}
      >
        {t("eventDetail.removedBody")}
      </Text>
      <AccountButton
        label={t("eventDetail.backToMap")}
        onPress={() => router.navigate("/map")}
        testID={`${testID}-map`}
      />
    </View>
  );
}
