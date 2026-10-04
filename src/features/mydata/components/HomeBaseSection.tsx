import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { SettingsRowBody } from "@/features/account/components/SettingsRow";
import { pickLocalizedName } from "@/features/geo";
import { useLocationPermissionGranted } from "@/features/location";
import {
  HOME_BASE_ELSEWHERE_ID,
  HOME_BASE_TOWNS,
  TownPicker,
  usePrefsStore,
  type HomeBasePreference,
} from "@/features/onboarding";
import { useTheme } from "@/theme";
import { HomeBaseRow } from "./HomeBaseRow";

/**
 * The reader's home town ("HomeBase"): the place notifications are judged
 * against and the felt-report location falls back to. Lived on the Settings
 * tab until 2026-09-27, then here as its own section; since the account
 * page redesign (2026-10-04) it is one row of the settings group, and a tap
 * opens the town picker inline below it. The store and its consumers are
 * untouched; only the chrome changed.
 */
export function HomeBaseSection() {
  const { t, i18n } = useTranslation();
  const { colors, typography } = useTheme();
  const homeBase = usePrefsStore((state) => state.homeBase);
  const setHomeBase = usePrefsStore((state) => state.setHomeBase);
  const homeBaseSource = usePrefsStore((state) => state.homeBaseSource);
  const resumeAutoHomeBase = usePrefsStore((state) => state.resumeAutoHomeBase);
  const locationGranted = useLocationPermissionGranted();
  const [isPicking, setIsPicking] = useState(false);

  const currentTown = homeBase
    ? HOME_BASE_TOWNS.find((town) => town.id === homeBase.townId)
    : null;
  const townName = currentTown
    ? pickLocalizedName(currentTown.names, i18n.language)
    : null;
  const isAuto = homeBaseSource === "auto" && townName !== null;
  // Only offered when it can work: a hand-picked town and permission granted.
  const canResumeAuto = homeBaseSource === "manual" && locationGranted === true;

  function handleResumeAuto() {
    resumeAutoHomeBase();
    setIsPicking(false);
  }

  function handleSelectTown(townId: string) {
    const town = HOME_BASE_TOWNS.find((candidate) => candidate.id === townId);
    if (!town) {
      return;
    }
    const next: HomeBasePreference = { townId: town.id, lat: town.lat, lon: town.lon };
    setHomeBase(next);
    setIsPicking(false);
  }

  function handleSelectElsewhere() {
    setHomeBase(null);
    setIsPicking(false);
  }

  return (
    <View>
      <HomeBaseRow
        townName={townName}
        isAuto={isAuto}
        expanded={isPicking}
        onToggle={() => setIsPicking((value) => !value)}
      />
      {canResumeAuto || isPicking ? (
        <SettingsRowBody>
          {canResumeAuto ? (
            <Pressable
              accessibilityRole="button"
              onPress={handleResumeAuto}
              hitSlop={12}
              style={styles.linkTarget}
            >
              <Text style={[typography.labelButton, { color: colors.text.link }]}>
                {t("settings.homeBaseUseLocation")}
              </Text>
            </Pressable>
          ) : null}
          {isPicking ? (
            <TownPicker
              selectedTownId={homeBase?.townId ?? HOME_BASE_ELSEWHERE_ID}
              onSelectTown={handleSelectTown}
              onSelectElsewhere={handleSelectElsewhere}
            />
          ) : null}
        </SettingsRowBody>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // >= 44 px tall tap target for the text link.
  linkTarget: { minHeight: 44, justifyContent: "center" },
});
