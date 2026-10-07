import { useTranslation } from "react-i18next";

import { OnboardingScreenShell, usePrefsStore } from "@/features/onboarding";
import { useTourLaunchStore } from "@/features/tour";

/**
 * Screen 6 — "you're set" (spec-v1.md §4.11 step 6). Completing onboarding
 * here flips `onboardingCompleted`, which the root layout reads to swap its
 * registered screens from the onboarding stack to the tab bar — no manual
 * navigation call needed, React Navigation resolves the new default screen
 * (Home) itself once "(tabs)" becomes a valid route again.
 *
 * "Take a quick tour" completes onboarding the same way and leaves a note for
 * the root layout (`useLaunchPendingTour`) to open `/tour` once the main stack
 * exists; pushing it from here would target a route that is not registered
 * yet. Finishing or skipping the tour lands on Home.
 */
export default function OnboardingDoneScreen() {
  const { t } = useTranslation();
  const completeOnboarding = usePrefsStore((state) => state.completeOnboarding);
  const requestTour = useTourLaunchStore((state) => state.request);

  function handleTakeTour() {
    requestTour();
    completeOnboarding();
  }

  return (
    <OnboardingScreenShell
      step="done"
      title={t("onboarding.done.title")}
      description={t("onboarding.done.description")}
      primaryLabel={t("onboarding.done.cta")}
      onPrimaryPress={completeOnboarding}
      secondaryLabel={t("onboarding.done.tourCta")}
      onSecondaryPress={handleTakeTour}
    />
  );
}
