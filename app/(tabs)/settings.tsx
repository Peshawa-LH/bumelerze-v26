import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { changeLocale, SUPPORTED_LOCALES, type SupportedLocale } from "@/i18n";
import { restartApp } from "@/i18n/restart-app";
import { useTheme } from "@/theme";

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const [isRestarting, setIsRestarting] = useState(false);

  async function handleSelectLocale(locale: SupportedLocale) {
    if (isRestarting || locale === i18n.language) {
      return;
    }

    const { requiresRestart } = await changeLocale(locale);
    if (!requiresRestart) {
      return;
    }

    setIsRestarting(true);
    try {
      await restartApp();
    } catch {
      setIsRestarting(false);
      Alert.alert(t("settings.title"), t("settings.languageRestartFailedMessage"));
    }
  }

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surface.base,
          paddingTop: insets.top + spacing[6],
          paddingBottom: insets.bottom + spacing[6],
          paddingStart: spacing[5],
          paddingEnd: spacing[5],
        },
      ]}
    >
      <Text
        accessibilityRole="header"
        style={[
          styles.title,
          {
            color: colors.text.primary,
            fontSize: typography.h1.fontSize,
            lineHeight: typography.h1.lineHeight,
            fontWeight: typography.h1.fontWeight,
          },
        ]}
      >
        {t("settings.title")}
      </Text>

      <Text
        style={[
          styles.sectionTitle,
          {
            color: colors.text.primary,
            fontSize: typography.h3.fontSize,
            lineHeight: typography.h3.lineHeight,
            fontWeight: typography.h3.fontWeight,
          },
        ]}
      >
        {t("settings.languageSectionTitle")}
      </Text>

      <Text
        style={[
          styles.sectionDescription,
          {
            color: colors.text.secondary,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
          },
        ]}
      >
        {isRestarting
          ? t("settings.languageRestartNotice")
          : t("settings.languageSectionDescription")}
      </Text>

      <View style={styles.languageList}>
        {SUPPORTED_LOCALES.map((locale) => {
          const isActive = i18n.language === locale;
          return (
            <Pressable
              key={locale}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive, disabled: isRestarting }}
              disabled={isRestarting}
              onPress={() => handleSelectLocale(locale)}
              style={[
                styles.languageRow,
                {
                  borderColor: colors.border.default,
                  backgroundColor: isActive ? colors.surface.raised : "transparent",
                },
              ]}
            >
              <Text
                style={{
                  color: colors.text.primary,
                  fontSize: typography.bodyDefault.fontSize,
                  fontWeight: isActive ? "700" : "400",
                }}
              >
                {t(`settings.languages.${locale}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: 12,
  },
  title: {},
  sectionTitle: {
    marginTop: 8,
  },
  sectionDescription: {},
  languageList: {
    gap: 8,
    marginTop: 8,
  },
  languageRow: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    paddingStart: 16,
    paddingEnd: 16,
  },
});
