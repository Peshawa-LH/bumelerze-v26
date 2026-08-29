import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ISC2025_MAX_USEFUL_DISTANCE_KM } from "../../config";
import type { Isc2025Result } from "../../types";
import type { SpectrumCodeValues } from "../types";
import { CHART_DEFAULT_T_MAX, CHART_EXTENDED_T_MAX } from "../config";
import { computeSpectrumParameters } from "../compute";
import { buildSpectrumCurve } from "../curve";
import { formatCoefficient, formatPeriodSeconds } from "../format";
import { iscSiteClassFromVs30 } from "../isc-site-class";
import { SpectrumChart } from "./SpectrumChart";
import { SpectrumControlPointTable } from "./SpectrumControlPointTable";
import { SpectrumInputsForm } from "./SpectrumInputsForm";
import { useSpectrumInputsState } from "./use-spectrum-inputs-state";

interface SpectrumSectionProps {
  /** The coordinate lookup's sampled Vs30, `null` when the coordinate falls
   * outside the bundled grid — mirrors `HandbookLookupResult.vs30MS`
   * exactly so the section can sit directly below the existing result
   * table with no extra plumbing. */
  vs30MS: number | null;
  /** The coordinate's ISC-2025 lookup, used to pre-fill `Ss`/`S1`. */
  isc2025: Isc2025Result;
  locale: string;
}

/** Only offer the code's numbers where they mean something: inside a mapped
 * zone band, or close enough to a tabulated district. Otherwise the form
 * opens empty and the engineer supplies both, which is the honest state for
 * a site the code does not cover. */
function toCodeValues(isc2025: Isc2025Result): SpectrumCodeValues | null {
  const nearest = isc2025.nearestDistrict;
  if (!nearest) {
    return null;
  }
  if (isc2025.zone === null && nearest.distanceKm > ISC2025_MAX_USEFUL_DISTANCE_KM) {
    return null;
  }
  return {
    ss: nearest.district.ss2475G,
    s1: nearest.district.s12475G,
    districtName: nearest.district.nameEn,
    distanceKm: nearest.distanceKm,
  };
}

/**
 * Wave 1 spectrum calculator (`handbook-spectra-design.md` §9) — lives
 * inside the handbook screen as a section below the existing coordinate
 * lookup result table (§8.5: "not a new tab, not a new route"). Renders
 * nothing until the engineer has entered valid `Ss`/`S1` — this is a
 * professional deep-dive tool one step past the lookup table, not
 * something that competes with it for attention on first paint.
 */
export function SpectrumSection({ vs30MS, isc2025, locale }: SpectrumSectionProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [showFullRange, setShowFullRange] = useState(false);

  const derivedSiteClass = vs30MS === null ? null : iscSiteClassFromVs30(vs30MS);
  const state = useSpectrumInputsState(derivedSiteClass ?? "D", toCodeValues(isc2025));

  const tMax = showFullRange ? CHART_EXTENDED_T_MAX : CHART_DEFAULT_T_MAX;

  const params = state.inputs ? computeSpectrumParameters(state.inputs) : null;
  const curve = state.inputs && params ? buildSpectrumCurve(params, state.inputs.r, tMax) : null;

  return (
    <View style={{ gap: spacing[4] }}>
      <Text
        accessibilityRole="header"
        style={{
          color: colors.text.primary,
          fontSize: typography.h2.fontSize,
          lineHeight: typography.h2.lineHeight,
          fontWeight: typography.h2.fontWeight,
        }}
      >
        {t("handbook.spectrum.sectionTitle")}
      </Text>

      {/* Persistent framing banner (§6.1 proxy-Vs30 note, §7's "not a
       * design spectrum of record" instruction) — attached to the
       * feature, not tucked into an About screen. */}
      <View
        style={{
          borderWidth: 1,
          borderRadius: 12,
          borderColor: colors.status.warning,
          backgroundColor: colors.surface.raised,
          padding: spacing[4],
          gap: spacing[2],
        }}
      >
        <Text
          style={{
            color: colors.text.primary,
            fontSize: typography.bodyMeta.fontSize,
            fontWeight: "600",
          }}
        >
          {t("handbook.spectrum.banner.title")}
        </Text>
        <Text style={{ color: colors.text.secondary, fontSize: typography.bodyMeta.fontSize }}>
          {t("handbook.spectrum.banner.notOfRecord")}
        </Text>
        <Text style={{ color: colors.text.secondary, fontSize: typography.bodyMeta.fontSize }}>
          {t(
            state.codeValues
              ? "handbook.spectrum.banner.ssS1FromCode"
              : "handbook.spectrum.banner.ssS1Source",
          )}
        </Text>
        <Text style={{ color: colors.text.secondary, fontSize: typography.bodyMeta.fontSize }}>
          {t("handbook.spectrum.banner.vs30Proxy")}
        </Text>
      </View>

      <SpectrumInputsForm state={state} derivedSiteClass={derivedSiteClass} locale={locale} />

      {state.inputs && params && curve ? (
        <View style={{ gap: spacing[4] }}>
          <ErrorBoundary
            fallback={() => (
              <Text style={{ color: colors.status.danger, fontSize: typography.bodyDefault.fontSize }}>
                {t("handbook.spectrum.chartError")}
              </Text>
            )}
          >
            <SpectrumChart
              curve={curve}
              params={params}
              tMax={tMax}
              locale={locale}
              accessibilityLabel={t("handbook.spectrum.chartA11yLabel", {
                plateau: formatCoefficient(params.sds, locale),
                t0: formatPeriodSeconds(params.t0, locale),
                ts: formatPeriodSeconds(params.ts, locale),
                sd1: formatCoefficient(params.sd1, locale),
              })}
            />
          </ErrorBoundary>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: showFullRange }}
            onPress={() => setShowFullRange((value) => !value)}
            hitSlop={8}
          >
            <Text style={{ color: colors.text.link, fontSize: typography.bodyMeta.fontSize }}>
              {t(
                showFullRange
                  ? "handbook.spectrum.rangeToggle.showDefault"
                  : "handbook.spectrum.rangeToggle.showFull",
              )}
            </Text>
          </Pressable>

          <SpectrumControlPointTable inputs={state.inputs} params={params} locale={locale} />
        </View>
      ) : null}
    </View>
  );
}
