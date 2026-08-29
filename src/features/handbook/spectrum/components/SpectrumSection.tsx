import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import type { Isc2025Result } from "../../types";
import type { SpectrumCodeValues } from "../types";
import { CHART_DEFAULT_T_MAX, CHART_EXTENDED_T_MAX } from "../config";
import { computeSpectrumParameters, governingCs } from "../compute";
import { allowableDrift } from "../drift";
import { computePeriod } from "../period";
import { buildSpectrumCurve } from "../curve";
import {
  formatCodeCoefficient,
  formatCoefficient,
  formatPeriodSeconds,
  formatPlainNumber,
} from "../format";
import { iscSiteClassFromVs30 } from "../isc-site-class";
import { checkHeight } from "../structural-systems";
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

/** The interpolated values at the queried point, or null outside the code's
 * coverage — where the form opens empty and the engineer supplies both,
 * which is the honest state for a site the code does not cover. */
function toCodeValues(isc2025: Isc2025Result): SpectrumCodeValues | null {
  const nearest = isc2025.nearestDistrict;
  if (!isc2025.values || !nearest) {
    return null;
  }
  return {
    ss: isc2025.values.ss2475,
    s1: isc2025.values.s12475,
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

      {/* --- System coefficients and the height-limit check ---
       * The height limit is the part an arithmetic calculator cannot give:
       * the app already knows this site's design category, so it can say
       * the chosen system is not permitted here at all, which is a
       * compliance answer rather than a number. */}
      {state.system && params ? (
        (() => {
          const check = checkHeight(state.system, params.seismicDesignCategory, state.heightM);
          const blocked = check.status === "notPermitted" || check.status === "overLimit";
          return (
            <View
              style={{
                borderWidth: 1,
                borderRadius: 12,
                borderColor: blocked ? colors.status.danger : colors.border.default,
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
                {t(`handbook.spectrum.systems.${state.system.id}`)}
              </Text>
              <Text style={{ color: colors.text.secondary, fontSize: typography.bodyMeta.fontSize }}>
                {t("handbook.spectrum.systemCoefficients", {
                  r: formatPlainNumber(state.system.r, locale),
                  omega0: formatPlainNumber(state.system.omega0, locale),
                  cd: formatPlainNumber(state.system.cd, locale),
                })}
              </Text>
              <Text
                accessibilityRole={blocked ? "alert" : undefined}
                style={{
                  color: blocked ? colors.status.danger : colors.text.secondary,
                  fontSize: typography.bodyMeta.fontSize,
                }}
              >
                {check.status === "notPermitted"
                  ? t("handbook.spectrum.heightCheck.notPermitted", {
                      sdc: params.seismicDesignCategory,
                    })
                  : check.status === "unlimited"
                    ? t("handbook.spectrum.heightCheck.unlimited", {
                        sdc: params.seismicDesignCategory,
                      })
                    : check.status === "overLimit"
                      ? t("handbook.spectrum.heightCheck.overLimit", {
                          sdc: params.seismicDesignCategory,
                          limit: formatPlainNumber(check.limitM, locale),
                        })
                      : t("handbook.spectrum.heightCheck.withinLimit", {
                          sdc: params.seismicDesignCategory,
                          limit: formatPlainNumber(check.limitM, locale),
                        })}
              </Text>
              {/* Period and the governing Cs, both of which need a height.
               * Without one the app shows neither rather than guessing a
               * building size. */}
              {state.heightM !== null && state.inputs ? (
                (() => {
                  const period = computePeriod(state.system!, state.heightM, params.sd1);
                  // Designed at Ta itself, which the code permits and which
                  // is the conservative choice: Cu*Ta is only a ceiling for
                  // a period obtained by modal analysis, which this app does
                  // not do.
                  const cs = governingCs(params, state.inputs.r, period.ta);
                  return (
                    <View style={{ gap: spacing[1] }}>
                      <Text style={{ color: colors.text.secondary, fontSize: typography.bodyMeta.fontSize }}>
                        {t("handbook.spectrum.period.ta", {
                          ta: formatPeriodSeconds(period.ta, locale),
                          ct: formatCodeCoefficient(period.ct, locale),
                          x: formatCodeCoefficient(period.x, locale),
                        })}
                      </Text>
                      <Text style={{ color: colors.text.secondary, fontSize: typography.bodyMeta.fontSize }}>
                        {t("handbook.spectrum.period.cuTa", {
                          cuTa: formatPeriodSeconds(period.cuTa, locale),
                          cu: formatCodeCoefficient(period.cu, locale),
                        })}
                      </Text>
                      <Text style={{ color: colors.text.primary, fontSize: typography.bodyMeta.fontSize, fontWeight: "600" }}>
                        {t("handbook.spectrum.period.cs", {
                          cs: formatCoefficient(cs.cs, locale),
                          governedBy: t(`handbook.spectrum.period.governedBy.${cs.governedBy}`),
                        })}
                      </Text>
                    </View>
                  );
                })()
              ) : (
                <Text style={{ color: colors.text.tertiary, fontSize: typography.bodyMeta.fontSize }}>
                  {t("handbook.spectrum.period.needsHeight")}
                </Text>
              )}

              <Text style={{ color: colors.text.secondary, fontSize: typography.bodyMeta.fontSize }}>
                {t("handbook.spectrum.driftLimit", {
                  ratio: formatCodeCoefficient(
                    allowableDrift(state.system!, state.occupancy).ratio,
                    locale,
                  ),
                })}
              </Text>

              <Text style={{ color: colors.text.tertiary, fontSize: typography.bodyMeta.fontSize, fontStyle: "italic" }}>
                {t("handbook.spectrum.systemCitation")}
              </Text>
            </View>
          );
        })()
      ) : null}

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
