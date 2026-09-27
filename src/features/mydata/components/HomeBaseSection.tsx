import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { pickLocalizedName } from "@/features/geo";
import {
  HOME_BASE_ELSEWHERE_ID,
  HOME_BASE_TOWNS,
  TownPicker,
  usePrefsStore,
  type HomeBasePreference,
} from "@/features/onboarding";
import { useTheme } from "@/theme";

/**
 * The reader's home town ("HomeBase"): the place notifications are judged
 * against and the felt-report location falls back to. Lived on the
 * Settings tab until 2026-09-27; the owner's Settings rearrangement
 * (feedback 2adfbbf7) put it here — "homebase ... belongs in my data" — on
 * the screen that is becoming the account (name, contributions, and in
 * time the tagged building). The store and its consumers are untouched;
 * only the surface moved.
 */
export function HomeBaseSection() {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const homeBase = usePrefsStore((state) => state.homeBase);
  const setHomeBase = usePrefsStore((state) => state.setHomeBase);
  const [isPicking, setIsPicking] = useState(false);

  const currentTown = homeBase
    ? HOME_BASE_TOWNS.find((town) => town.id === homeBase.townId)
    : null;
  const currentLabel = currentTown
    ? pickLocalizedName(currentTown.names, i18n.language)
    : t("onboarding.homeBase.notSet");

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
    <View style={{ gap: spacing[2] }}>
      <Text
        style={{
          color: colors.text.primary,
          fontSize: typography.h3.fontSize,
          lineHeight: typography.h3.lineHeight,
          fontWeight: typography.h3.fontWeight,
        }}
      >
        {t("settings.homeBaseSectionTitle")}
      </Text>
      <View style={styles.spaceBetweenRow}>
        <Text
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
          }}
        >
          {currentLabel}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => setIsPicking((value) => !value)}
          hitSlop={12}
        >
          <Text
            style={{
              color: colors.text.link,
              fontSize: typography.labelButton.fontSize,
              fontWeight: typography.labelButton.fontWeight,
            }}
          >
            {t("settings.homeBaseChange")}
          </Text>
        </Pressable>
      </View>
      {isPicking ? (
        <TownPicker
          selectedTownId={homeBase?.townId ?? HOME_BASE_ELSEWHERE_ID}
          onSelectTown={handleSelectTown}
          onSelectElsewhere={handleSelectElsewhere}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  spaceBetweenRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
