import { Redirect, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import {
  OnboardingScreenShell,
  onboardingRouteForStep,
  usePrefsStore,
} from "@/features/onboarding";

/**
 * Screen 1 — mission (spec-v1.md §4.11 step 1): "always know, in your
 * language". Sets the expectation that this is a Kurdistan-first,
 * science-backed app before anything else is asked of the user.
 */
export default function OnboardingMissionScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const onboardingStep = usePrefsStore((state) => state.onboardingStep);
  const setOnboardingStep = usePrefsStore((state) => state.setOnboardingStep);

  // A forced reload mid-onboarding (the language screen's RTL-flip restart
  // is the only thing that triggers one) remounts the whole app back here,
  // the flow's first screen. If we already got further than this before the
  // reload, bounce straight to that step instead of making the user redo
  // screens they already completed (wave brief: "must ... RESUME
  // onboarding, not restart it").
  if (onboardingStep !== "mission") {
    return <Redirect href={onboardingRouteForStep(onboardingStep)} />;
  }

  function handleContinue() {
    setOnboardingStep("language");
    router.push("/onboarding/language");
  }

  return (
    <OnboardingScreenShell
      step="mission"
      showBack={false}
      title={t("onboarding.mission.title")}
      description={t("onboarding.mission.description")}
      primaryLabel={t("onboarding.continue")}
      onPrimaryPress={handleContinue}
    />
  );
}
