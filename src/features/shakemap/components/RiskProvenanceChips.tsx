import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import type { TranslateFn } from "@/features/geo";
import { localizeDigits } from "@/lib/format-numbers";
import type { Theme } from "@/theme";
import type { ReviewStatus, RiskTimeOfDay } from "../types";

export interface RiskProvenanceChipsProps {
  stage: string;
  timeOfDay: RiskTimeOfDay;
  nDraws: number;
  reviewStatus: ReviewStatus;
  /** `null` hides the download button entirely (owner: "Hide the button
   * when there is no report URL") — no product-schema-version-1 event has
   * ever failed to publish one of the three risk artifacts alongside its
   * report, but a partial/older publish is still handled gracefully. */
  reportUrl: string | null;
  locale: string;
  t: TranslateFn;
  colors: Theme["colors"];
  typography: Theme["typography"];
  spacing: Theme["spacing"];
}

/** `RiskSummary.stage`/`RiskDistricts.stage` -> a plain-language i18n key
 * — this internal pipeline-stage id is NEVER shown verbatim (D46 follow-up:
 * "never show the raw code"). Unrecognized/future stage codes fall back to
 * a generic "Fragility model" label rather than leaking the raw string. */
const STAGE_NAME_KEYS: Record<string, string> = {
  pga_lognormal: "eventDetail.risk.stageNames.pgaLognormal",
  gl2004: "eventDetail.risk.stageNames.gl2004",
  ims25_rules: "eventDetail.risk.stageNames.ims25Rules",
};

function stageNameKey(stage: string): string {
  return STAGE_NAME_KEYS[stage] ?? "eventDetail.risk.stageNames.unknown";
}

interface ChipProps {
  testID: string;
  label: string;
  colors: Theme["colors"];
  typography: Theme["typography"];
  spacing: Theme["spacing"];
}

function Chip({ testID, label, colors, typography, spacing }: ChipProps) {
  return (
    <View
      testID={testID}
      style={[
        styles.chip,
        {
          backgroundColor: colors.surface.sunken,
          paddingHorizontal: spacing[3],
          paddingVertical: spacing[1],
        },
      ]}
    >
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.labelCaption.fontSize,
          lineHeight: typography.labelCaption.lineHeight,
          fontWeight: "600",
        }}
      >
        {label}
      </Text>
    </View>
  );
}

/**
 * The provenance strip — small chips (review status, occupancy snapshot,
 * simulation count, fragility method) rather than the old full-sentence
 * paragraph, plus the fixed casualties-not-published sentence, the "see
 * the Atlas for exact figures" pointer (no link out), and — when the
 * product published one — a "Download report (PDF)" button opening the
 * per-version Bumelerze Atlas PDF (`Linking.openURL`). A failed open
 * (offline, blocked) fails soft into an inline message, same "never a
 * crash, never a silent no-op" convention the rest of this app's offline
 * paths follow (`OfflineBanner`'s own icon+text treatment).
 */
export function RiskProvenanceChips({
  stage,
  timeOfDay,
  nDraws,
  reviewStatus,
  reportUrl,
  locale,
  t,
  colors,
  typography,
  spacing,
}: RiskProvenanceChipsProps) {
  const [downloadFailed, setDownloadFailed] = useState(false);

  async function handleDownloadPress() {
    if (!reportUrl) {
      return;
    }
    setDownloadFailed(false);
    try {
      await Linking.openURL(reportUrl);
    } catch {
      // Fail soft (offline, blocked popup, unsupported URL) — never a
      // crash, never a silent no-op either: an inline message tells the
      // user what happened.
      setDownloadFailed(true);
    }
  }

  return (
    <View style={{ gap: spacing[3] }}>
      <View style={[styles.chipRow, { gap: spacing[2] }]}>
        <Chip
          testID="risk-provenance-chip-review-status"
          label={t(`eventDetail.risk.chips.${reviewStatus === "reviewed" ? "reviewed" : "provisional"}`)}
          colors={colors}
          typography={typography}
          spacing={spacing}
        />
        <Chip
          testID="risk-provenance-chip-time-of-day"
          label={t(`eventDetail.risk.chips.timeOfDay.${timeOfDay}`)}
          colors={colors}
          typography={typography}
          spacing={spacing}
        />
        <Chip
          testID="risk-provenance-chip-simulations"
          label={t("eventDetail.risk.chips.simulations", {
            count: localizeDigits(String(nDraws), locale),
          })}
          colors={colors}
          typography={typography}
          spacing={spacing}
        />
        <Chip
          testID="risk-provenance-chip-fragility"
          label={t("eventDetail.risk.chips.fragility", { method: t(stageNameKey(stage)) })}
          colors={colors}
          typography={typography}
          spacing={spacing}
        />
      </View>

      <View style={{ gap: spacing[1] }}>
        <Text
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyMeta.fontSize,
            lineHeight: typography.bodyMeta.lineHeight,
          }}
        >
          {t("eventDetail.risk.casualtiesNote")}
        </Text>
        <Text
          style={{
            color: colors.text.tertiary,
            fontSize: typography.labelCaption.fontSize,
            lineHeight: typography.labelCaption.lineHeight,
          }}
        >
          {t("eventDetail.risk.detailedFigures")}
        </Text>
      </View>

      {reportUrl ? (
        <View style={{ gap: spacing[1] }}>
          <Pressable
            testID="risk-download-report"
            accessibilityRole="button"
            accessibilityHint={t("eventDetail.risk.downloadReportHint")}
            onPress={handleDownloadPress}
            hitSlop={8}
            style={[
              styles.downloadButton,
              {
                borderColor: colors.border.default,
                paddingHorizontal: spacing[4],
                paddingVertical: spacing[2],
                gap: spacing[2],
              },
            ]}
          >
            <Ionicons name="document-text" size={16} color={colors.text.primary} />
            <Text
              style={{
                color: colors.text.primary,
                fontSize: typography.bodyMeta.fontSize,
                fontWeight: "600",
              }}
            >
              {t("eventDetail.risk.downloadReport")}
            </Text>
          </Pressable>
          {downloadFailed ? (
            <View style={[styles.offlineRow, { gap: spacing[1] }]}>
              <Ionicons name="cloud-offline-outline" size={14} color={colors.text.secondary} />
              <Text
                style={{
                  color: colors.text.secondary,
                  fontSize: typography.labelCaption.fontSize,
                  lineHeight: typography.labelCaption.lineHeight,
                }}
              >
                {t("eventDetail.risk.downloadReportOffline")}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  chip: {
    borderRadius: 999,
  },
  downloadButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
  },
  offlineRow: {
    flexDirection: "row",
    alignItems: "center",
  },
});
