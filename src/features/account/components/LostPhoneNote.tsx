import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme, nativeFontFamily, READING_START } from "@/theme";
import { AccountButton } from "./AccountButton";

/** "Lost your phone?": the way back in without the authenticator is the
 * Feedback form (the team checks it is you and removes the old code). */
export function LostPhoneNote({ onContactUs }: { onContactUs: () => void }) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  return (
    <View style={{ gap: spacing[2] }} testID="two-step-lost-phone">
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyMeta.fontSize,
          fontFamily: nativeFontFamily(typography.bodyMeta),
          ...READING_START,
          lineHeight: typography.bodyMeta.lineHeight,
        }}
      >
        {t("account.twoStep.lostPhone")}
      </Text>
      <AccountButton
        label={t("account.signIn.forgotContact")}
        onPress={onContactUs}
        testID="two-step-contact-us"
      />
    </View>
  );
}
