import { Platform, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import { formatContributorId } from "../format";
import { useContributorId } from "../use-contributor-id";

/**
 * My Data header (D26 item 7): the install's own contribution identity — a
 * friendly short form of the anonymous per-install device id, plus a
 * one-line explanation that it exists without any account/registration.
 * Mirrors the SPIRIT of the owner's MyShake reference screenshot
 * (internal design reference, MyShake's personal identity/
 * summary card at the top of the screen), not its exact layout.
 */
export function IdentityHeader() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const deviceId = useContributorId();
  const contributorIdText = deviceId ? formatContributorId(deviceId) : null;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[4],
          gap: spacing[2],
        },
      ]}
    >
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.labelCaption.fontSize,
          lineHeight: typography.labelCaption.lineHeight,
          fontWeight: typography.labelCaption.fontWeight,
        }}
      >
        {t("myData.headerLabel")}
      </Text>
      <Text
        allowFontScaling
        accessibilityLabel={
          contributorIdText
            ? t("myData.headerIdA11yLabel", { id: contributorIdText })
            : undefined
        }
        style={[
          styles.idText,
          {
            color: colors.text.primary,
            fontSize: typography.h2.fontSize,
          },
        ]}
      >
        {contributorIdText ?? t("myData.headerIdLoading")}
      </Text>
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyMeta.fontSize,
          lineHeight: typography.bodyMeta.lineHeight,
        }}
      >
        {t("myData.headerExplanation")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 14,
  },
  idText: {
    fontWeight: "700",
    letterSpacing: 1,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  },
});
