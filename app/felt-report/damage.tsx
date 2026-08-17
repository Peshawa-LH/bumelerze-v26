import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/theme";
import {
  BUILDING_DAMAGE_GRADES,
  DAMAGE_ARTWORK,
  DAMAGE_TYPOLOGIES,
  DamageTile,
  useTier2DraftStore,
  useTileGridLayout,
  type BuildingDamageGrade,
  type DamageTypology,
} from "@/features/felt";

/**
 * Window 2 of 3 — damage picker (2026-08-15 flow restructure, owner
 * directive). Two typology rows (high-rise / single-low-rise, each 5
 * grades DG1-DG5) plus a prominent "I didn't see damage" default that lets
 * the user pass through with one tap. Every tile — including the default —
 * both records the pick AND advances to window 3 immediately, the same
 * one-tap philosophy as tier 1's cartoon grid and the tier-2 questionnaire.
 * The pick is written into the shared post-tier-1 draft (`tier2-draft-
 * store.ts`), not submitted yet — window 3's Submit is what actually
 * upgrades the queued tier-1 report (`queue.ts`'s `enqueueTier2Report`).
 */
export default function DamageReportScreen() {
  const { feltReportId, eventId } = useLocalSearchParams<{
    feltReportId: string;
    eventId?: string;
  }>();
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const initDraft = useTier2DraftStore((state) => state.initDraft);
  const setAnswer = useTier2DraftStore((state) => state.setAnswer);
  // Both typology rows are 5-column grids at the same gap (`styles.grid`
  // below) and the same horizontal padding, so one measurement covers both
  // — see `grid-layout.ts`'s doc comment on sharing a single instance.
  const { tileWidth, onLayout: onGridLayout } = useTileGridLayout(
    DAMAGE_TILE_COLUMNS,
    DAMAGE_TILE_GAP,
  );

  useEffect(() => {
    if (feltReportId) {
      initDraft(feltReportId, eventId || null);
    }
  }, [feltReportId, eventId, initDraft]);

  function goToDetails() {
    router.push({
      pathname: "/felt-report/details",
      params: { feltReportId, eventId: eventId ?? "" },
    });
  }

  function handleSelectGrade(typology: DamageTypology, grade: BuildingDamageGrade) {
    setAnswer("damageTypology", typology);
    setAnswer("buildingDamageLevel", grade);
    goToDetails();
  }

  function handleNoDamage() {
    // Generic shortcut: grade 1 (no visible damage), no typology implied
    // (see `Tier2Answers.damageTypology`'s own doc for why this is distinct
    // from explicitly picking a row's DG1 tile).
    setAnswer("damageTypology", null);
    setAnswer("buildingDamageLevel", 1);
    goToDetails();
  }

  function handleClose() {
    if (router.canDismiss()) {
      router.dismiss();
    } else {
      router.back();
    }
  }

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
          {t("felt.damage.title")}
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
          {t("felt.damage.subtitle")}
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("felt.damage.noDamage.label")}
          accessibilityHint={t("felt.damage.noDamage.hint")}
          onPress={handleNoDamage}
          style={({ pressed }) => [
            styles.noDamageButton,
            {
              backgroundColor: colors.brand.primary,
              paddingVertical: spacing[3],
              opacity: pressed ? 0.9 : 1,
            },
          ]}
        >
          <Text
            allowFontScaling
            style={{
              color: colors.brand.onPrimary,
              fontSize: typography.labelButton.fontSize,
              fontWeight: typography.labelButton.fontWeight,
            }}
          >
            {t("felt.damage.noDamage.label")}
          </Text>
        </Pressable>

        {DAMAGE_TYPOLOGIES.map((typology) => (
          <View key={typology} style={{ gap: spacing[2] }}>
            <Text
              accessibilityRole="header"
              style={{
                color: colors.text.primary,
                fontSize: typography.labelCaption.fontSize,
                fontWeight: typography.labelCaption.fontWeight,
                textTransform: "uppercase",
              }}
            >
              {t(`felt.damage.typologies.${typology}`)}
            </Text>
            <View style={styles.grid} onLayout={onGridLayout}>
              {BUILDING_DAMAGE_GRADES.map((grade) => {
                const gradeLabel = t(`felt.damage.grades.${typology}.${grade}`);
                return (
                  <DamageTile
                    key={`${typology}-${grade}`}
                    typology={typology}
                    grade={grade}
                    label={gradeLabel}
                    locale={i18n.language}
                    accessibilityLabel={`${t(`felt.damage.typologies.${typology}`)}. ${gradeLabel}`}
                    onPress={handleSelectGrade}
                    imageSource={DAMAGE_ARTWORK[typology][grade]}
                    width={tileWidth}
                  />
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

// One typology row (5 damage grades DG1-DG5) per grid — must match
// `styles.grid`'s `gap` below (kept as named constants, not a magic 10, so
// the two can never drift apart silently).
const DAMAGE_TILE_COLUMNS = 5;
const DAMAGE_TILE_GAP = 10;

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
    gap: DAMAGE_TILE_GAP,
  },
  noDamageButton: {
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
});
