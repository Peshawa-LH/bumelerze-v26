import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  AccessibilityInfo,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { pickLocalizedName } from "@/features/geo";
import { HOME_BASE_TOWNS } from "@/features/onboarding";
import { useTheme } from "@/theme";
import {
  CARTOON_LEVELS,
  enqueueTier1Report,
  InlineTownPicker,
  LEVEL_ARTWORK,
  LevelTile,
  SEVERE_DESTRUCTION_THRESHOLD,
  useFeltLocation,
  type CartoonLevel,
} from "@/features/felt";

/**
 * Window 1 of 3 — the panic-time tap (spec-v1.md §4.6, D8; windows 2/3
 * added 2026-08-15 flow restructure, owner directive). Exactly the original
 * 12 EMS-98 cartoon grid, one tap selects — but where the old flow showed a
 * confirmation state in place, it now IMMEDIATELY, durably queues a
 * tier-1-only report (the one-tap promise: never lost even if the user
 * quits right here) and moves on to window 2 (damage). Windows 2/3 then
 * UPGRADE that same queued report in place — see `app/felt-report/damage.tsx`
 * and `details.tsx`, and `queue.ts`'s `enqueueTier2Report` doc for the
 * supersede mechanism both windows share with the "add more detail"
 * questionnaire.
 */
export default function Tier1FeltReportScreen() {
  const { eventId } = useLocalSearchParams<{ eventId?: string }>();
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [isLocationExpanded, setIsLocationExpanded] = useState(false);
  const { location, isGps, manualTownId, setManualTownId } = useFeltLocation();

  const associatedEventId = eventId ?? null;

  async function handleSelectLevel(level: CartoonLevel) {
    const report = await enqueueTier1Report({
      cartoonLevel: level,
      location,
      eventId: associatedEventId,
    });

    // Screen-reader announcement for the panic-time submission itself
    // (accessibility-tester Phase 5 audit): a blind user needs to know a
    // tap durably recorded their report even though the screen is about to
    // navigate away — `AccessibilityInfo.announceForAccessibility` works on
    // both TalkBack and VoiceOver (unlike `accessibilityLiveRegion`, which
    // VoiceOver ignores).
    AccessibilityInfo.announceForAccessibility(t("felt.tier1.queuedAnnouncement"));

    router.push({
      pathname: "/felt-report/damage",
      params: { feltReportId: report.reportId, eventId: associatedEventId ?? "" },
    });
  }

  function handleClose() {
    if (router.canDismiss()) {
      router.dismiss();
    } else {
      router.back();
    }
  }

  const manualTownName = (() => {
    const town = HOME_BASE_TOWNS.find((candidate) => candidate.id === manualTownId);
    return town ? pickLocalizedName(town.names, i18n.language) : "";
  })();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surface.base,
          paddingTop: insets.top + spacing[4],
          paddingBottom: insets.bottom + spacing[4],
          paddingStart: spacing[5],
          paddingEnd: spacing[5],
        },
      ]}
    >
      <View style={styles.topRow}>
        <Text
          accessibilityRole="header"
          style={{
            color: colors.text.primary,
            fontSize: typography.h1.fontSize,
            lineHeight: typography.h1.lineHeight,
            fontWeight: typography.h1.fontWeight,
          }}
        >
          {t("felt.tier1.title")}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("felt.tier1.close")}
          onPress={handleClose}
          hitSlop={12}
        >
          <Text
            style={{
              color: colors.text.link,
              fontSize: typography.labelButton.fontSize,
              fontWeight: typography.labelButton.fontWeight,
            }}
          >
            {t("felt.tier1.close")}
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ gap: spacing[4], paddingTop: spacing[3] }}>
        <Text
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
          }}
        >
          {t("felt.tier1.subtitle")}
        </Text>

        <View style={{ gap: spacing[2] }}>
          <Pressable
            // Only announced/behaves as an actionable button when there is
            // a real action (manual-location fallback) — under GPS
            // location this row is read-only status text, so a screen
            // reader shouldn't announce it as a button with no effect
            // (accessibility-tester Phase 5 audit).
            accessibilityRole={isGps ? "text" : "button"}
            onPress={isGps ? undefined : () => setIsLocationExpanded((v) => !v)}
            hitSlop={12}
            style={{ flexDirection: "row", justifyContent: "space-between" }}
          >
            <Text
              style={{
                color: colors.text.secondary,
                fontSize: typography.bodyMeta.fontSize,
              }}
            >
              {isGps
                ? t("felt.tier1.locationGps")
                : t("felt.tier1.locationManual", { place: manualTownName })}
            </Text>
            {!isGps ? (
              <Text
                style={{
                  color: colors.text.link,
                  fontSize: typography.bodyMeta.fontSize,
                  fontWeight: "600",
                }}
              >
                {t("felt.tier1.changeLocation")}
              </Text>
            ) : null}
          </Pressable>
          {!isGps && isLocationExpanded ? (
            <InlineTownPicker
              selectedTownId={manualTownId}
              onSelectTown={setManualTownId}
            />
          ) : null}
        </View>

        <View style={styles.grid}>
          {CARTOON_LEVELS.filter((level) => level < SEVERE_DESTRUCTION_THRESHOLD).map(
            (level) => (
              <LevelTile
                key={level}
                level={level}
                locale={i18n.language}
                label={t(`felt.tier1.levels.${level}.label`)}
                onPress={(selected) => void handleSelectLevel(selected)}
                imageSource={LEVEL_ARTWORK[level]}
              />
            ),
          )}
        </View>

        <Text
          style={{
            color: colors.text.secondary,
            fontSize: typography.labelCaption.fontSize,
            fontWeight: typography.labelCaption.fontWeight,
            textTransform: "uppercase",
          }}
        >
          {t("felt.tier1.severeDestructionHeader")}
        </Text>
        <View style={styles.grid}>
          {CARTOON_LEVELS.filter((level) => level >= SEVERE_DESTRUCTION_THRESHOLD).map(
            (level) => (
              <LevelTile
                key={level}
                level={level}
                locale={i18n.language}
                label={t(`felt.tier1.levels.${level}.label`)}
                onPress={(selected) => void handleSelectLevel(selected)}
                imageSource={LEVEL_ARTWORK[level]}
                compact
              />
            ),
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
});
