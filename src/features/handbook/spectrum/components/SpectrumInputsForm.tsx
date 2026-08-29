import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import { VERIFIED_R_VALUES } from "../config";
import { occupancyLabelKey } from "../format";
import type { IscSiteClass, OccupancyCategory } from "../types";
import type { NumberFieldError } from "../validation";
import type { SpectrumInputsState } from "./use-spectrum-inputs-state";

const SITE_CLASSES: readonly IscSiteClass[] = ["A", "B", "C", "D", "E"];
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
}

/**
 * Ss/S1 entry, ISC site-class override, importance-category picker and R
 * (verified value + free entry) — `handbook-spectra-design.md` §7.4's
 * input table, built as one form. No submit button: every valid keystroke
 * recomputes the spectrum live (`SpectrumSection` reads `state.inputs`
 * directly), matching "quick tool" framing over a multi-step wizard.
 */
export function SpectrumInputsForm({ state, derivedSiteClass }: SpectrumInputsFormProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();

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
        {t("handbook.spectrum.ssS1Note")}
      </Text>

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

      {/* --- R --- */}
      <View style={{ gap: spacing[2] }}>
        <Text style={{ color: colors.text.secondary, fontSize: typography.bodyMeta.fontSize }}>
          {t("handbook.spectrum.rLabel")}
        </Text>
        <Text style={{ color: colors.text.tertiary, fontSize: typography.bodyMeta.fontSize }}>
          {t("handbook.spectrum.rNote")}
        </Text>
        <View style={[styles.chipRow, { gap: spacing[2] }]}>
          {VERIFIED_R_VALUES.map(({ r, labelKey }) => (
            <Pressable
              key={r}
              accessibilityRole="button"
              onPress={() => state.setRText(String(r))}
              style={[
                styles.chip,
                {
                  borderColor: Number(state.rText) === r ? colors.brand.primary : colors.border.default,
                  backgroundColor: Number(state.rText) === r ? colors.brand.primary : "transparent",
                },
              ]}
            >
              <Text
                style={{
                  color: Number(state.rText) === r ? colors.brand.onPrimary : colors.text.primary,
                  fontSize: typography.labelButton.fontSize,
                  fontWeight: typography.labelButton.fontWeight,
                }}
              >
                {t("handbook.spectrum.rChipLabel", { r, systemLabel: t(labelKey) })}
              </Text>
            </Pressable>
          ))}
        </View>
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
