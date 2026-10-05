import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { refreshAutoHomeBase } from "@/features/location";
import {
  applyDefaultHomeBase,
  OnboardingScreenShell,
  usePrefsStore,
} from "@/features/onboarding";

/**
 * Screen 3 — location permission (spec-v1.md §4.11 step 3). Scientific-
 * contribution framing (LastQuake pattern: "your location makes your
 * reports valid scientific testimony") comes before the real foreground
 * permission request. Whatever the user answers, the flow continues — a
 * denial is never a dead end (spec: "if a user denies a permission
 * mid-flow, the flow must continue").
 */
export default function OnboardingLocationScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const setOnboardingStep = usePrefsStore((state) => state.setOnboardingStep);
  const [isRequesting, setIsRequesting] = useState(false);

  function goNext() {
    // Without location the HomeBase is Erbil (owner); with location the
    // nearest town replaces it as soon as the first fix arrives.
    applyDefaultHomeBase();
    setOnboardingStep("notifications");
    router.push("/onboarding/notifications");
  }

  async function handleAllow() {
    setIsRequesting(true);
    try {
      // Foreground-only (wave brief) — no background/"always" location is
      // ever requested anywhere in this app.
      const { granted } = await Location.requestForegroundPermissionsAsync();
      // HomeBase is automatic: the nearest town from this first fix. The
      // root-level check ran before permission existed, so ask again now.
      if (granted) {
        void refreshAutoHomeBase();
      }
    } catch {
      // Hardware/platform failure — never blocks the flow (spec-v1.md
      // §4.11 states).
    } finally {
      setIsRequesting(false);
      goNext();
    }
  }

  return (
    <OnboardingScreenShell
      step="location"
      title={t("onboarding.location.title")}
      description={t("onboarding.location.description")}
      primaryLabel={t("onboarding.location.allow")}
      onPrimaryPress={() => void handleAllow()}
      primaryDisabled={isRequesting}
      secondaryLabel={t("onboarding.location.notNow")}
      onSecondaryPress={goNext}
    />
  );
}
