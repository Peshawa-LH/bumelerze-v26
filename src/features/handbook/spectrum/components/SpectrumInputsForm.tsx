import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import { formatDistanceKm, isolateNumeric } from "@/features/events";
import { STRUCTURAL_SYSTEMS, type StructuralSystemCategory } from "../structural-systems";
import { formatCodeCoefficient, occupancyLabelKey } from "../format";
import type { IscSiteClass, OccupancyCategory } from "../types";
import type { NumberFieldError } from "../validation";
import type { SpectrumInputsState } from "./use-spectrum-inputs-state";

const SITE_CLASSES: readonly IscSiteClass[] = ["A", "B", "C", "D", "E"];
const CATEGORY_ORDER: readonly StructuralSystemCategory[] = [
  "momentFrame",
  "bearingWall",
  "buildingFrame",
];
const OCCUPANCIES: readonly OccupancyCategory[] = ["I_II", "III", "IV"];

/** `ssError`/`s1Error` never actually carry "empty" (the hook filters it to
 * `null` on first paint, see `use-spectrum-inputs-state.ts`), but `rError`
 * can — an engineer can clear the R field entirely. Handling all three
 * keeps this exhaustive rather than assuming the filtered shape. */
function fieldErrorKey(error: NumberFieldError): string {
  switch (error) {
    case "empty":
      return "handbook.spectrum.errorEmpty";
    case "notANumber":
      return "handbook.spectrum.errorNotANumber";
    case "outOfRange":
      return "handbook.spectrum.errorOutOfRange";
  }
}

interface SpectrumInputsFormProps {
  state: SpectrumInputsState;
  /** `null` when the coordinate has no Vs30 sample — the pre-fill/"derived"
   * framing is skipped and the engineer picks a class with no default. */
  derivedSiteClass: IscSiteClass | null;
  locale: string;
}

/**
 * Ss/S1 entry, ISC site-class override, importance-category picker and R
 * (verified value + free entry) — `handbook-spectra-design.md` §7.4's
 * input table, built as one form. No submit button: every valid keystroke
 * recomputes the spectrum live (`SpectrumSection` reads `state.inputs`
 * directly), matching "quick tool" framing over a multi-step wizard.
 */
export function SpectrumInputsForm({
  state,
  derivedSiteClass,
  locale,
}: SpectrumInputsFormProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const { codeValues } = state;
  // Collapsed by default. Listing all 16 systems inline cost 1103 px, a
  // third more than a phone screen, on a page already 7.6 screens long —
  // and an engineer picks a system once, then never looks at the list
  // again. The chosen one stays visible; the rest is one tap away.
  const [systemListOpen, setSystemListOpen] = useState(false);

  return (
    <View style={{ gap: spacing[4] }}>
      <Text
        accessibilityRole="header"
        style={{
          color: colors.text.primary,
          fontSize: typography.h3.fontSize,
          lineHeight: typography.h3.lineHeight,
          fontWeight: typography.h3.fontWeight,
        }}
      >
        {t("handbook.spectrum.formTitle")}
      </Text>

      <Text style={{ color: colors.text.secondary, fontSize: typography.bodyMeta.fontSize }}>
        {t(codeValues ? "handbook.spectrum.ssS1NoteFromCode" : "handbook.spectrum.ssS1Note")}
      </Text>

      {/* Provenance for the pre-filled pair. The distance is shown because
       * these are published values AT a district, not interpolated to the
       * queried point — a value from 3 km away and one from 60 km away are
       * different claims and must not read the same. */}
      {codeValues ? (
        <View style={{ gap: spacing[1] }}>
          <Text style={{ color: colors.text.secondary, fontSize: typography.bodyMeta.fontSize }}>
            {t(
              state.isOverriddenFromCode
                ? "handbook.spectrum.codeValues.overridden"
                : "handbook.spectrum.codeValues.prefilled",
              {
                district: codeValues.districtName,
                distance: isolateNumeric(formatDistanceKm(codeValues.distanceKm, locale)),
              },
            )}
          </Text>
          {state.isOverriddenFromCode ? (
            <Pressable accessibilityRole="button" onPress={state.resetToCodeValues} hitSlop={8}>
              <Text style={{ color: colors.text.link, fontSize: typography.bodyMeta.fontSize }}>
                {t("handbook.spectrum.codeValues.reset")}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* --- Ss --- */}
      <View style={{ gap: spacing[2] }}>
        <Text style={{ color: colors.text.secondary, fontSize: typography.bodyMeta.fontSize }}>
          {t("handbook.spectrum.ssLabel")}
        </Text>
        <TextInput
          value={state.ssText}
          onChangeText={state.setSsText}
          placeholder={t("handbook.spectrum.ssPlaceholder")}
          placeholderTextColor={colors.text.tertiary}
          accessibilityLabel={t("handbook.spectrum.ssLabel")}
          keyboardType="default"
          autoCorrect={false}
          style={[
            styles.input,
            {
              color: colors.text.primary,
              borderColor: state.ssError ? colors.status.danger : colors.border.default,
              backgroundColor: colors.surface.raised,
              fontSize: typography.bodyDefault.fontSize,
              padding: spacing[3],
            },
          ]}
        />
        {state.ssError ? (
          <Text accessibilityRole="alert" style={{ color: colors.status.danger, fontSize: typography.bodyMeta.fontSize }}>
            {t(fieldErrorKey(state.ssError))}
          </Text>
        ) : null}
      </View>

      {/* --- S1 --- */}
      <View style={{ gap: spacing[2] }}>
        <Text style={{ color: colors.text.secondary, fontSize: typography.bodyMeta.fontSize }}>
          {t("handbook.spectrum.s1Label")}
        </Text>
        <TextInput
          value={state.s1Text}
          onChangeText={state.setS1Text}
          placeholder={t("handbook.spectrum.s1Placeholder")}
          placeholderTextColor={colors.text.tertiary}
          accessibilityLabel={t("handbook.spectrum.s1Label")}
          keyboardType="default"
          autoCorrect={false}
          style={[
            styles.input,
            {
              color: colors.text.primary,
              borderColor: state.s1Error ? colors.status.danger : colors.border.default,
              backgroundColor: colors.surface.raised,
              fontSize: typography.bodyDefault.fontSize,
              padding: spacing[3],
            },
          ]}
        />
        {state.s1Error ? (
          <Text accessibilityRole="alert" style={{ color: colors.status.danger, fontSize: typography.bodyMeta.fontSize }}>
            {t(fieldErrorKey(state.s1Error))}
          </Text>
        ) : null}
      </View>

      {/* --- Site class override --- */}
      <View style={{ gap: spacing[2] }}>
        <Text style={{ color: colors.text.secondary, fontSize: typography.bodyMeta.fontSize }}>
          {t("handbook.spectrum.siteClassLabel")}
        </Text>
        <Text style={{ color: colors.text.tertiary, fontSize: typography.bodyMeta.fontSize }}>
          {derivedSiteClass
            ? t("handbook.spectrum.siteClassDerivedNote", { siteClass: derivedSiteClass })
            : t("handbook.spectrum.siteClassNoDerivedNote")}
        </Text>
        <View style={[styles.chipRow, { gap: spacing[2] }]} accessibilityRole="radiogroup">
          {SITE_CLASSES.map((siteClass) => {
            const isActive = state.siteClass === siteClass;
            return (
              <Pressable
                key={siteClass}
                accessibilityRole="radio"
                accessibilityState={{ selected: isActive, checked: isActive }}
                accessibilityLabel={t("handbook.spectrum.siteClassOptionA11y", { siteClass })}
                onPress={() => state.setSiteClass(siteClass)}
                style={[
                  styles.chip,
                  {
                    borderColor: isActive ? colors.brand.primary : colors.border.default,
                    backgroundColor: isActive ? colors.brand.primary : "transparent",
                  },
                ]}
              >
                <Text
                  style={{
                    color: isActive ? colors.brand.onPrimary : colors.text.primary,
                    fontSize: typography.labelButton.fontSize,
                    fontWeight: typography.labelButton.fontWeight,
                  }}
                >
                  {siteClass}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {state.isSiteClassOverridden && derivedSiteClass ? (
          <Pressable accessibilityRole="button" onPress={state.resetSiteClassToDerived} hitSlop={8}>
            <Text style={{ color: colors.text.link, fontSize: typography.bodyMeta.fontSize }}>
              {t("handbook.spectrum.resetSiteClass", { siteClass: derivedSiteClass })}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {/* --- Importance category --- */}
      <View style={{ gap: spacing[2] }}>
        <Text style={{ color: colors.text.secondary, fontSize: typography.bodyMeta.fontSize }}>
          {t("handbook.spectrum.occupancyLabel")}
        </Text>
        <View style={{ gap: spacing[2] }} accessibilityRole="radiogroup">
          {OCCUPANCIES.map((occupancy) => {
            const isActive = state.occupancy === occupancy;
            return (
              <Pressable
                key={occupancy}
                accessibilityRole="radio"
                accessibilityState={{ selected: isActive, checked: isActive }}
                onPress={() => state.setOccupancy(occupancy)}
                style={[
                  styles.row,
                  {
                    borderColor: isActive ? colors.brand.primary : colors.border.default,
                    backgroundColor: isActive ? colors.surface.raised : "transparent",
                    paddingVertical: spacing[3],
                    paddingStart: spacing[4],
                    paddingEnd: spacing[4],
                  },
                ]}
              >
                <Text
                  allowFontScaling
                  style={{
                    color: colors.text.primary,
                    fontSize: typography.bodyDefault.fontSize,
                    lineHeight: typography.bodyDefault.lineHeight,
                    fontWeight: isActive ? "700" : "400",
                  }}
                >
                  {t(occupancyLabelKey(occupancy))}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* --- Seismic-force-resisting system ---
       * Replaces blind `R` entry: choosing the real system yields R, and
       * with it the overstrength and deflection-amplification factors the
       * engineer needs downstream, plus the height limit the app can check
       * against this site's design category. */}
      <View style={{ gap: spacing[2] }}>
        <Text style={{ color: colors.text.secondary, fontSize: typography.bodyMeta.fontSize }}>
          {t("handbook.spectrum.systemLabel")}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: systemListOpen }}
          onPress={() => setSystemListOpen((open) => !open)}
          style={[
            styles.systemRow,
            { borderColor: colors.border.default, padding: spacing[3] },
          ]}
        >
          <Text style={{ color: colors.text.primary, fontSize: typography.bodyDefault.fontSize }}>
            {state.system
              ? t(`handbook.spectrum.systems.${state.system.id}`)
              : t("handbook.spectrum.systemOther")}
          </Text>
          <Text style={{ color: colors.text.link, fontSize: typography.bodyMeta.fontSize }}>
            {t(systemListOpen ? "handbook.spectrum.systemHideList" : "handbook.spectrum.systemChange")}
          </Text>
        </Pressable>

        {systemListOpen ? (
          <View style={{ gap: spacing[2] }}>
            {CATEGORY_ORDER.map((category) => (
              <View key={category} style={{ gap: spacing[1] }}>
                <Text style={{ color: colors.text.tertiary, fontSize: typography.bodyMeta.fontSize }}>
                  {t(`handbook.spectrum.systemCategories.${category}`)}
                </Text>
                {STRUCTURAL_SYSTEMS.filter((sys) => sys.category === category).map((sys) => {
                  const selected = state.systemId === sys.id;
                  return (
                    <Pressable
                      key={sys.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => {
                        state.setSystemId(sys.id);
                        setSystemListOpen(false);
                      }}
                      style={[
                        styles.systemRow,
                        {
                          borderColor: selected ? colors.brand.primary : colors.border.default,
                          backgroundColor: selected ? colors.surface.raised : "transparent",
                          padding: spacing[3],
                        },
                      ]}
                    >
                      <Text style={{ color: colors.text.primary, fontSize: typography.bodyMeta.fontSize }}>
                        {t(`handbook.spectrum.systems.${sys.id}`)}
                      </Text>
                      <Text style={{ color: colors.text.secondary, fontSize: typography.bodyMeta.fontSize }}>
                        {t("handbook.spectrum.systemCoefficients", {
                          r: formatCodeCoefficient(sys.r, locale),
                          omega0: formatCodeCoefficient(sys.omega0, locale),
                          cd: formatCodeCoefficient(sys.cd, locale),
                        })}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: state.systemId === null }}
              onPress={() => {
                state.setSystemId(null);
                setSystemListOpen(false);
              }}
              style={[
                styles.systemRow,
                {
                  borderColor: state.systemId === null ? colors.brand.primary : colors.border.default,
                  backgroundColor: state.systemId === null ? colors.surface.raised : "transparent",
                  padding: spacing[3],
                },
              ]}
            >
              <Text style={{ color: colors.text.primary, fontSize: typography.bodyMeta.fontSize }}>
                {t("handbook.spectrum.systemOther")}
              </Text>
            </Pressable>

                        <Text style={{ color: colors.text.tertiary, fontSize: typography.bodyMeta.fontSize }}>
              {t("handbook.spectrum.systemSubsetNote")}
            </Text>
          </View>
        ) : null}
      </View>

      {/* --- R, only when no system is chosen --- */}
      {state.systemId === null ? (
        <View style={{ gap: spacing[2] }}>
          <Text style={{ color: colors.text.secondary, fontSize: typography.bodyMeta.fontSize }}>
            {t("handbook.spectrum.rLabel")}
          </Text>
          <Text style={{ color: colors.text.tertiary, fontSize: typography.bodyMeta.fontSize }}>
            {t("handbook.spectrum.rNote")}
          </Text>
          <TextInput
            value={state.rText}
            onChangeText={state.setRText}
            placeholder={t("handbook.spectrum.rPlaceholder")}
            placeholderTextColor={colors.text.tertiary}
            accessibilityLabel={t("handbook.spectrum.rLabel")}
            keyboardType="default"
            autoCorrect={false}
            style={[
              styles.input,
              {
                color: colors.text.primary,
                borderColor: state.rError ? colors.status.danger : colors.border.default,
                backgroundColor: colors.surface.raised,
                fontSize: typography.bodyDefault.fontSize,
                padding: spacing[3],
              },
            ]}
          />
          {state.rError ? (
            <Text accessibilityRole="alert" style={{ color: colors.status.danger, fontSize: typography.bodyMeta.fontSize }}>
              {t(fieldErrorKey(state.rError))}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* --- Building height (optional) --- */}
      <View style={{ gap: spacing[2] }}>
        <Text style={{ color: colors.text.secondary, fontSize: typography.bodyMeta.fontSize }}>
          {t("handbook.spectrum.heightLabel")}
        </Text>
        <TextInput
          value={state.heightText}
          onChangeText={state.setHeightText}
          placeholder={t("handbook.spectrum.heightPlaceholder")}
          placeholderTextColor={colors.text.tertiary}
          accessibilityLabel={t("handbook.spectrum.heightLabel")}
          keyboardType="default"
          autoCorrect={false}
          style={[
            styles.input,
            {
              color: colors.text.primary,
              borderColor: state.heightError ? colors.status.danger : colors.border.default,
              backgroundColor: colors.surface.raised,
              fontSize: typography.bodyDefault.fontSize,
              padding: spacing[3],
            },
          ]}
        />
        {state.heightError ? (
          <Text accessibilityRole="alert" style={{ color: colors.status.danger, fontSize: typography.bodyMeta.fontSize }}>
            {t(fieldErrorKey(state.heightError))}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: 10,
  },
  row: {
    borderWidth: 2,
    borderRadius: 12,
    minHeight: 48,
    justifyContent: "center",
  },
  systemRow: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 44,
    justifyContent: "center",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  chip: {
    borderWidth: 1.5,
    borderRadius: 999,
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
});
