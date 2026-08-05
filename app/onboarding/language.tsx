import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { SUPPORTED_LOCALES, type SupportedLocale } from "@/i18n";
import { useLocaleSwitcher } from "@/i18n/use-locale-switcher";
import { OnboardingScreenShell, usePrefsStore } from "@/features/onboarding";
import { useTheme } from "@/theme";

/**
 * Screen 2 — language selection (spec-v1.md §4.11 step 2, D12): "the one
 * onboarding screen where the four-locale requirement is literally the
 * content". Reuses the exact same changeLocale/restart logic as Settings
 * (useLocaleSwitcher) — the only addition here is persisting the resume
 * step *before* a restart fires, so a forced reload lands back on the next
 * screen instead of the start of onboarding (wave brief).
 */
export default function OnboardingLanguageScreen() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();
  const setOnboardingStep = usePrefsStore((state) => state.setOnboardingStep);

  const { isRestarting, selectLocale, currentLocale } = useLocaleSwitcher({
    onBeforeRestart: () => setOnboardingStep("location"),
  });

  async function handleSelectLocale(locale: SupportedLocale) {
    await selectLocale(locale);
    // If a restart was required, the app has already reloaded by the time
    // this resolves (or the reload failed, in which case isRestarting is
    // now false again and the user can simply try again or press Continue).
  }

  function handleContinue() {
    setOnboardingStep("location");
    router.push("/onboarding/location");
  }

  return (
    <OnboardingScreenShell
      step="language"
      title={t("onboarding.language.title")}
      description={
        isRestarting
          ? t("settings.languageRestartNotice")
          : t("onboarding.language.description")
      }
      primaryLabel={t("onboarding.continue")}
      onPrimaryPress={handleContinue}
      primaryDisabled={isRestarting}
    >
      <View style={{ gap: spacing[2] }}>
        {SUPPORTED_LOCALES.map((locale) => {
          const isActive = currentLocale === locale;
          return (
            <Pressable
              key={locale}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive, disabled: isRestarting }}
              disabled={isRestarting}
              onPress={() => void handleSelectLocale(locale)}
              style={[
                styles.row,
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
    </OnboardingScreenShell>
  );
}

const styles = StyleSheet.create({
  row: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    paddingStart: 16,
    paddingEnd: 16,
  },
});
