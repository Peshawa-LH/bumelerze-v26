import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { pickLocalizedName } from "@/features/geo";
import { HOME_BASE_TOWNS } from "@/features/onboarding";
import { useTheme } from "@/theme";
import {
  CARTOON_LEVELS,
  enqueueTier1Report,
  InlineTownPicker,
  LevelTile,
  SEVERE_DESTRUCTION_THRESHOLD,
  useFeltLocation,
  useQueueItemState,
  type CartoonLevel,
  type Tier1Report,
} from "@/features/felt";

/**
 * Tier 1 — the panic-time tap (spec-v1.md §4.6, D8). 12 EMS-98 cartoon
 * levels, one tap selects AND submits; the same screen then shows a
 * confirmation state in place (no route change) so this stays a true
 * one-screen, one-tap flow. Big type, minimal chrome — this is THE
 * panic-time screen (PROJECT.md).
 */
export default function Tier1FeltReportScreen() {
  const { eventId } = useLocalSearchParams<{ eventId?: string }>();
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [submitted, setSubmitted] = useState<Tier1Report | null>(null);
  const [isLocationExpanded, setIsLocationExpanded] = useState(false);
  const { location, isGps, manualTownId, setManualTownId } = useFeltLocation();
  const queueState = useQueueItemState(submitted?.reportId ?? null);

  const associatedEventId = eventId ?? null;

  async function handleSelectLevel(level: CartoonLevel) {
    const report = await enqueueTier1Report({
      cartoonLevel: level,
      location,
      eventId: associatedEventId,
    });
    setSubmitted(report);
  }

  function handleClose() {
    if (router.canDismiss()) {
      router.dismiss();
    } else {
      router.back();
    }
  }

  function handleAddDetail() {
    if (!submitted) {
      return;
    }
    router.push({
      pathname: "/felt-report/step/[step]",
      params: {
        step: "0",
        feltReportId: submitted.reportId,
        eventId: associatedEventId ?? "",
      },
    });
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
          {submitted ? t("felt.tier1.confirmation.title") : t("felt.tier1.title")}
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

      {submitted ? (
        <ScrollView contentContainerStyle={{ gap: spacing[4], paddingTop: spacing[4] }}>
          <Text
            style={{
              color: colors.text.secondary,
              fontSize: typography.bodyDefault.fontSize,
              lineHeight: typography.bodyDefault.lineHeight,
            }}
          >
            {/* PendingTransport always ends in "awaiting-backend" this wave
             * (no Supabase project yet) — the message stays honest about
             * that rather than implying a real server confirmation. */}
            {queueState === "submitted"
              ? t("felt.tier1.confirmation.submittedMessage")
              : t("felt.tier1.confirmation.queuedMessage")}
          </Text>
          {/* TODO(Phase 2, once felt_cells aggregation + a backend exist):
           * "N reports near you" live count (spec-v1.md §4.6) — needs a
           * server round-trip this wave has nothing to query. */}
          <Pressable
            accessibilityRole="button"
            onPress={handleAddDetail}
            style={[
              styles.primaryButton,
              { backgroundColor: colors.brand.primary, paddingVertical: spacing[3] },
            ]}
          >
            <Text
              style={{
                color: colors.brand.onPrimary,
                fontSize: typography.labelButton.fontSize,
                fontWeight: typography.labelButton.fontWeight,
              }}
            >
              {t("felt.tier1.confirmation.addDetail")}
            </Text>
          </Pressable>
        </ScrollView>
      ) : (
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
              accessibilityRole="button"
              onPress={() => (isGps ? undefined : setIsLocationExpanded((v) => !v))}
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
                  compact
                />
              ),
            )}
          </View>
        </ScrollView>
      )}
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
  primaryButton: {
    borderRadius: 12,
    alignItems: "center",
  },
});
