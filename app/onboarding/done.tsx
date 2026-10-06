import { useTranslation } from "react-i18next";

import { OnboardingScreenShell, usePrefsStore } from "@/features/onboarding";

/**
 * Screen 6 — "you're set" (spec-v1.md §4.11 step 6). Completing onboarding
 * here flips `onboardingCompleted`, which the root layout reads to swap its
 * registered screens from the onboarding stack to the tab bar — no manual
 * navigation call needed, React Navigation resolves the new default screen
 * (Home) itself once "(tabs)" becomes a valid route again.
 */
export default function OnboardingDoneScreen() {
  const { t } = useTranslation();
  const completeOnboarding = usePrefsStore((state) => state.completeOnboarding);

  return (
    <OnboardingScreenShell
      step="done"
      title={t("onboarding.done.title")}
      description={t("onboarding.done.description")}
      primaryLabel={t("onboarding.done.cta")}
      onPrimaryPress={completeOnboarding}
    />
  );
}
