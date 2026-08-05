import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import {
  HOME_BASE_TOWNS,
  OnboardingScreenShell,
  TownPicker,
  usePrefsStore,
  type HomeBasePreference,
} from "@/features/onboarding";

/**
 * Screen 5 — HomeBase setup (spec-v1.md §4.11 step 5), optional/skippable —
 * a diaspora feature (P2, J3), never forced on P1. No map here: MapLibre is
 * Phase 3 (see towns.ts's upgrade-path comment) — this wave is a bundled
 * ~20-town list, same shape the future map-pin picker will still write.
 */
export default function OnboardingHomeBaseScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const homeBase = usePrefsStore((state) => state.homeBase);
  const setHomeBase = usePrefsStore((state) => state.setHomeBase);
  const setOnboardingStep = usePrefsStore((state) => state.setOnboardingStep);

  function goNext() {
    setOnboardingStep("done");
    router.push("/onboarding/done");
  }

  function handleSelectTown(townId: string) {
    const town = HOME_BASE_TOWNS.find((candidate) => candidate.id === townId);
    if (!town) {
      return;
    }
    const next: HomeBasePreference = { townId: town.id, lat: town.lat, lon: town.lon };
    setHomeBase(next);
    goNext();
  }

  function handleSelectElsewhere() {
    setHomeBase(null);
    goNext();
  }

  return (
    <OnboardingScreenShell
      step="homeBase"
      title={t("onboarding.homeBase.title")}
      description={t("onboarding.homeBase.description")}
      primaryLabel={t("onboarding.homeBase.skip")}
      onPrimaryPress={goNext}
    >
      <TownPicker
        selectedTownId={homeBase?.townId ?? null}
        onSelectTown={handleSelectTown}
        onSelectElsewhere={handleSelectElsewhere}
      />
    </OnboardingScreenShell>
  );
}
