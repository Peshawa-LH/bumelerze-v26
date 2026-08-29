import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import * as Clipboard from "expo-clipboard";

import { useTheme } from "@/theme";
import { isolateNumeric } from "@/features/events";
import { spectralAcceleration } from "../curve";
import {
  formatCoefficient,
  formatIscSiteClass,
  formatPeriodSeconds,
  formatPlainNumber,
  formatSeismicDesignCategory,
  serializeControlPointTableForClipboard,
} from "../format";
import type { SpectrumInputs, SpectrumParameters } from "../types";

interface SpectrumControlPointTableProps {
  inputs: SpectrumInputs;
  params: SpectrumParameters;
  locale: string;
}

interface Row {
  labelKey: string;
  value: string;
}

/**
 * The control-point table — `handbook-spectra-design.md` §7.3: "the table
 * is not secondary", it is the deliverable, the chart supports it. Every
 * row here mirrors that document's §7.3 example table exactly (Ss/S1
 * through governing Cs pieces), in the same order.
 *
 * `Sa at T=1.0s` is included unconditionally because `S1` is anchored at
 * exactly 1 second — reading that value straight off the table lets an
 * engineer sanity-check the plotted curve against the input they typed
 * without measuring the chart.
 *
 * Label/value pairs use the app's existing `label` (bodyMeta) / `value`
 * (larger, primary) two-line row shape (`HandbookResultTable`'s `RowShell`)
 * rather than a wide grid — required at 375px and mandatory once 200% font
 * scale is in play (§8.4).
 */
export function SpectrumControlPointTable({ inputs, params, locale }: SpectrumControlPointTableProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clears the pending "copied" -> "idle" reset on unmount so a still-running
  // timer never fires a `setState` on an unmounted component (and never
  // leaves an open handle behind in tests).
  useEffect(() => {
    return () => {
      if (resetTimer.current !== null) {
        clearTimeout(resetTimer.current);
      }
    };
  }, []);

  // Reuses the same four-branch evaluator the chart plots from, rather
  // than assuming Sa(1s) = SD1 — that equality only holds when 1s falls in
  // the Ts < T <= TL branch (the common case for Iraqi Ss/S1 magnitudes,
  // since Ts is typically well under a second, but not guaranteed).
  const saAtOneSecondValue = spectralAcceleration(1.0, params);

  const rows: Row[] = [
    { labelKey: "handbook.spectrum.table.ss", value: `${formatCoefficient(inputs.ss, locale)} g` },
    { labelKey: "handbook.spectrum.table.s1", value: `${formatCoefficient(inputs.s1, locale)} g` },
    { labelKey: "handbook.spectrum.table.siteClass", value: formatIscSiteClass(inputs.siteClass) },
    { labelKey: "handbook.spectrum.table.fa", value: formatCoefficient(params.fa, locale) },
    { labelKey: "handbook.spectrum.table.fv", value: formatCoefficient(params.fv, locale) },
    { labelKey: "handbook.spectrum.table.sms", value: `${formatCoefficient(params.sms, locale)} g` },
    { labelKey: "handbook.spectrum.table.sm1", value: `${formatCoefficient(params.sm1, locale)} g` },
    { labelKey: "handbook.spectrum.table.sds", value: `${formatCoefficient(params.sds, locale)} g` },
    { labelKey: "handbook.spectrum.table.sd1", value: `${formatCoefficient(params.sd1, locale)} g` },
    { labelKey: "handbook.spectrum.table.t0", value: `${formatPeriodSeconds(params.t0, locale)} s` },
    { labelKey: "handbook.spectrum.table.ts", value: `${formatPeriodSeconds(params.ts, locale)} s` },
    { labelKey: "handbook.spectrum.table.tl", value: `${formatPeriodSeconds(params.tl, locale)} s` },
    { labelKey: "handbook.spectrum.table.saPlateau", value: `${formatCoefficient(params.sds, locale)} g` },
    { labelKey: "handbook.spectrum.table.saAtOneSecond", value: `${formatCoefficient(saAtOneSecondValue, locale)} g` },
    {
      labelKey: "handbook.spectrum.table.sdc",
      value: formatSeismicDesignCategory(params.seismicDesignCategory),
    },
    { labelKey: "handbook.spectrum.table.csUnreduced", value: formatCoefficient(params.csUnreduced, locale) },
    { labelKey: "handbook.spectrum.table.csFloor", value: formatCoefficient(params.csFloor, locale) },
    { labelKey: "handbook.spectrum.table.r", value: formatPlainNumber(inputs.r, locale) },
  ];

  async function handleCopy() {
    const localizedRows = rows.map((row) => ({ label: t(row.labelKey), value: row.value }));
    await Clipboard.setStringAsync(serializeControlPointTableForClipboard(localizedRows));
    setCopyState("copied");
    resetTimer.current = setTimeout(() => setCopyState("idle"), 2000);
  }

  return (
    <View style={{ gap: spacing[3] }}>
      <View style={styles.headerRow}>
        <Text
          accessibilityRole="header"
          style={{
            color: colors.text.primary,
            fontSize: typography.h3.fontSize,
            lineHeight: typography.h3.lineHeight,
            fontWeight: typography.h3.fontWeight,
          }}
        >
          {t("handbook.spectrum.table.title")}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={handleCopy}
          hitSlop={8}
          style={[styles.copyButton, { borderColor: colors.border.default }]}
        >
          <Text style={{ color: colors.text.link, fontSize: typography.labelButton.fontSize }}>
            {t(copyState === "copied" ? "handbook.spectrum.table.copied" : "handbook.spectrum.table.copy")}
          </Text>
        </Pressable>
      </View>

      {rows.map((row) => (
        <View key={row.labelKey} style={[styles.row, { borderColor: colors.border.default, padding: spacing[3], gap: spacing[1] }]}>
          <Text style={{ color: colors.text.secondary, fontSize: typography.bodyMeta.fontSize }}>
            {t(row.labelKey)}
          </Text>
          <Text
            style={{
              color: colors.text.primary,
              fontSize: typography.bodyDefault.fontSize,
              lineHeight: typography.bodyDefault.lineHeight,
              fontWeight: "600",
            }}
          >
            {isolateNumeric(row.value)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  copyButton: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  row: {
    borderWidth: 1,
    borderRadius: 12,
  },
});
