import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { GMPE_SET_LABEL } from "../config";
import {
  formatHandbookResultsTitle,
  formatIsc2025Source,
  formatIsc2025Value,
  formatNearbySoilSummary,
  formatNearestSoilPoint,
  formatPgaValue,
  formatSiteClassValue,
  formatVs30Value,
} from "../format";
import type { HandbookLookupResult } from "../types";
import { useTheme } from "@/theme";

interface HandbookResultTableProps {
  result: HandbookLookupResult;
}

interface RowShellProps {
  label: string;
  value: string;
  citation: string;
  sublabel?: string;
}

function RowShell({ label, value, citation, sublabel }: RowShellProps) {
  const { colors, typography, spacing } = useTheme();
  return (
    <View style={[styles.row, { borderColor: colors.border.default, gap: spacing[1], padding: spacing[3] }]}>
      <Text style={{ color: colors.text.secondary, fontSize: typography.bodyMeta.fontSize }}>{label}</Text>
      {sublabel ? (
        <Text style={{ color: colors.text.tertiary, fontSize: typography.bodyMeta.fontSize }}>{sublabel}</Text>
      ) : null}
      <Text
        style={{
          color: colors.text.primary,
          fontSize: typography.h3.fontSize,
          lineHeight: typography.h3.lineHeight,
          fontWeight: typography.h3.fontWeight,
        }}
      >
        {value}
      </Text>
      <Text style={{ color: colors.text.tertiary, fontSize: typography.bodyMeta.fontSize, fontStyle: "italic" }}>
        {citation}
      </Text>
    </View>
  );
}

/**
 * The cited output table (spec-v1.md §7: "table of design values with a
 * citation on every number"). Every row that HAS a number carries its
 * source; a row with no data for this coordinate shows the honest
 * empty-state message instead of a fabricated/nearest-neighbor value
 * (D14 trust principle, `lookup.ts`'s own doc comments). The soil-points
 * section is entirely absent (not an empty-state message) when nothing is
 * within radius — spec's own "else section hidden" instruction.
 */
export function HandbookResultTable({ result }: HandbookResultTableProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const locale = i18n.language;

  // The ISC-2025 table spans the whole country, so "no nearest district"
  // never happens inside Iraq; what does happen is a district so far away
  // that quoting it would be misleading. With no zone band either, that is
  // the honest out-of-coverage case.
  const isc2025Values = result.isc2025.values;

  const isEntirelyOutOfCoverage =
    result.pgaZone === null && result.vs30MS === null && result.nearbySoilPoints.length === 0;
  // `noUncheckedIndexedAccess` types index 0 as possibly-undefined even
  // though `nearbySoilPoints` is sorted nearest-first and non-empty
  // whenever this is used below — narrowing it once here (rather than a
  // non-null assertion at the call site) keeps that guarantee explicit.
  const nearestSoilPoint = result.nearbySoilPoints[0];

  return (
    <View style={{ gap: spacing[3] }}>
      <Text
        accessibilityRole="header"
        style={{
          color: colors.text.primary,
          fontSize: typography.h2.fontSize,
          lineHeight: typography.h2.lineHeight,
          fontWeight: typography.h2.fontWeight,
        }}
      >
        {formatHandbookResultsTitle(result, locale, t)}
      </Text>

      {isEntirelyOutOfCoverage ? (
        <Text
          accessibilityRole="alert"
          style={{ color: colors.text.secondary, fontSize: typography.bodyDefault.fontSize }}
        >
          {t("handbook.outOfCoverage")}
        </Text>
      ) : null}

      {/* --- ISC-2025 design spectral accelerations ---
       * First because it is the row an engineer actually designs from, and
       * because it is what feeds the spectrum section below. */}
      {isc2025Values ? (
        <RowShell
          label={t("handbook.rows.isc2025.label")}
          sublabel={formatIsc2025Source(result.isc2025, locale, t)}
          value={formatIsc2025Value(
            isc2025Values.ss2475,
            isc2025Values.s12475,
            isc2025Values.pga2475,
            locale,
            t,
          )}
          citation={t("handbook.rows.isc2025.citation")}
        />
      ) : (
        <View style={[styles.row, { borderColor: colors.border.default, gap: spacing[1], padding: spacing[3] }]}>
          <Text style={{ color: colors.text.secondary, fontSize: typography.bodyMeta.fontSize }}>
            {t("handbook.rows.isc2025.label")}
          </Text>
          <Text style={{ color: colors.text.secondary, fontSize: typography.bodyDefault.fontSize }}>
            {t("handbook.rows.isc2025.outsideCoverage")}
          </Text>
        </View>
      )}

      {/* --- PGA row --- */}
      {result.pgaZone ? (
        <RowShell
          label={t("handbook.rows.pga.label")}
          value={formatPgaValue(result.pgaZone.pgaG, result.pgaZone.zone, locale, t)}
          citation={t("handbook.rows.pga.citation")}
        />
      ) : (
        <View style={[styles.row, { borderColor: colors.border.default, gap: spacing[1], padding: spacing[3] }]}>
          <Text style={{ color: colors.text.secondary, fontSize: typography.bodyMeta.fontSize }}>
            {t("handbook.rows.pga.label")}
          </Text>
          <Text style={{ color: colors.text.secondary, fontSize: typography.bodyDefault.fontSize }}>
            {t("handbook.rows.pga.outsideZonation")}
          </Text>
        </View>
      )}

      {/* --- Vs30 row --- */}
      {result.vs30MS !== null ? (
        <RowShell
          label={t("handbook.rows.vs30.label")}
          sublabel={t("handbook.rows.vs30.sublabel")}
          value={formatVs30Value(result.vs30MS, locale, t)}
          citation={result.vs30Citation}
        />
      ) : (
        <View style={[styles.row, { borderColor: colors.border.default, gap: spacing[1], padding: spacing[3] }]}>
          <Text style={{ color: colors.text.secondary, fontSize: typography.bodyMeta.fontSize }}>
            {t("handbook.rows.vs30.label")}
          </Text>
          <Text style={{ color: colors.text.secondary, fontSize: typography.bodyDefault.fontSize }}>
            {t("handbook.rows.vs30.unavailable")}
          </Text>
        </View>
      )}

      {/* --- Site class row (derived from Vs30, so it shares that row's
       * honest-null state rather than duplicating the message) --- */}
      {result.siteClass ? (
        <RowShell
          label={t("handbook.rows.siteClass.label")}
          sublabel={t("handbook.rows.siteClass.sublabel")}
          value={formatSiteClassValue(result.siteClass.ec8, t)}
          citation={t("handbook.rows.siteClass.citation")}
        />
      ) : null}

      {/* --- Nearest Sulaimani soil/site point (hidden entirely when empty;
       * owner feedback 2026-08-21: was a per-point list that could run to
       * the full 303-point dataset, now a single summarized row —
       * `formatNearestSoilPoint`'s doc comment explains why no per-point
       * Vs30 numeral is shown, only the field EC8 classification) --- */}
      {nearestSoilPoint ? (
        <RowShell
          label={t("handbook.rows.soil.label")}
          sublabel={formatNearbySoilSummary(result.nearbySoilPoints.length, locale, t)}
          value={formatNearestSoilPoint(nearestSoilPoint, locale, t)}
          citation={t("handbook.rows.soil.citation")}
        />
      ) : null}

      {/* --- GMPE transparency row (static, not coordinate-dependent) --- */}
      <RowShell
        label={t("handbook.rows.gmpe.label")}
        value={GMPE_SET_LABEL}
        citation={t("handbook.rows.gmpe.note")}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    borderWidth: 1,
    borderRadius: 12,
  },
});
