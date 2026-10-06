import { Text } from "react-native";
import { useTranslation } from "react-i18next";

import { pickLocalizedName } from "@/features/geo";
import {
  HOME_BASE_TOWNS,
  OnboardingScreenShell,
  usePrefsStore,
} from "@/features/onboarding";
import { useTheme } from "@/theme";

/**
 * Screen 6 — "you're set" (spec-v1.md §4.11 step 6). Completing onboarding
 * here flips `onboardingCompleted`, which the root layout reads to swap its
 * registered screens from the onboarding stack to the tab bar — no manual
 * navigation call needed, React Navigation resolves the new default screen
 * (Home) itself once "(tabs)" becomes a valid route again.
 *
 * Says which HomeBase was set — the nearest town from location, or Hawler
 * when location wasn't allowed — and that it can be changed later (owner,
 * 2026-10-05).
 */
export default function OnboardingDoneScreen() {
  const { t, i18n } = useTranslation();
  const { colors, typography } = useTheme();
  const completeOnboarding = usePrefsStore((state) => state.completeOnboarding);
  const homeBase = usePrefsStore((state) => state.homeBase);
  const town = homeBase
    ? HOME_BASE_TOWNS.find((candidate) => candidate.id === homeBase.townId)
    : undefined;
  const townName = town ? pickLocalizedName(town.names, i18n.language) : null;

  return (
    <OnboardingScreenShell
      step="done"
      title={t("onboarding.done.title")}
      description={t("onboarding.done.description")}
      primaryLabel={t("onboarding.done.cta")}
      onPrimaryPress={completeOnboarding}
    >
      {townName ? (
        <Text
          testID="onboarding-done-home-base"
          style={{
            color: colors.text.primary,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
            fontWeight: "600",
          }}
        >
          {t("onboarding.done.homeBase", { town: townName })}
        </Text>
      ) : null}
    </OnboardingScreenShell>
  );
}
