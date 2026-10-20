import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { OnboardingScreenShell, usePrefsStore } from "@/features/onboarding";

/**
 * Screen 4 — notification explainer (the v1 spec §4.11 step 4): alerts are
 * coming (D83: public alerts stay "coming soon"; testers turn them on in
 * Notification Settings). The same screen on the web and in the phone app,
 * and on both it deliberately asks for NO permission (no expo-notifications
 * import at all): the phone's one-time question comes from the alert
 * controls, when a person turns alerts on for the device, and this text
 * promises exactly that ("We'll ask ... when that feature launches").
 */
export default function OnboardingNotificationsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const setOnboardingStep = usePrefsStore((state) => state.setOnboardingStep);

  function handleContinue() {
    setOnboardingStep("done");
    router.push("/onboarding/done");
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
