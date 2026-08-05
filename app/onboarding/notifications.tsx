import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { OnboardingScreenShell, usePrefsStore } from "@/features/onboarding";

/**
 * Screen 4 — notification explainer (spec-v1.md §4.11 step 4). v1 scope:
 * explain near-me/HomeBase alerts are coming — notifications themselves are
 * Phase 4 work, so this screen deliberately makes **no** real permission
 * request (no expo-notifications import at all). Keeping the screen in the
 * sequence now means the eventual real ask lands right after this same
 * value explanation, once Phase 4 wires it in.
 */
export default function OnboardingNotificationsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const setOnboardingStep = usePrefsStore((state) => state.setOnboardingStep);

  function handleContinue() {
    setOnboardingStep("homeBase");
    router.push("/onboarding/home-base");
  }

  return (
    <OnboardingScreenShell
      step="notifications"
      title={t("onboarding.notifications.title")}
      description={t("onboarding.notifications.description")}
      primaryLabel={t("onboarding.continue")}
      onPrimaryPress={handleContinue}
    />
  );
}
