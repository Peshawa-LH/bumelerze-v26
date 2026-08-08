import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { GAZETTEER_CITIES, pickLocalizedName } from "@/features/geo";
import { useUserDistanceAnchor } from "@/features/location";
import { useTheme } from "@/theme";
import {
  type CoordinateFieldError,
  validateLatitude,
  validateLongitude,
} from "../coordinate-validation";

interface CoordinateInputFormProps {
  onSubmit: (lat: number, lon: number) => void;
}

function fieldErrorKey(error: CoordinateFieldError): string {
  switch (error) {
    case "empty":
      return "handbook.coordinates.errorEmpty";
    case "notANumber":
      return "handbook.coordinates.errorNotANumber";
    case "outOfRange":
      return "handbook.coordinates.errorOutOfRange";
  }
}

/**
 * Coordinate entry (spec-v1.md §7): decimal-degrees text inputs (Latin
 * digits only — see `coordinate-validation.ts`'s doc comment), a "use my
 * location" button (reusing the existing read-only location anchor, same
 * as the rest of the app — never requests permission itself, spec-v1.md
 * §4.1 pattern), and an optional gazetteer town picker. Validation runs on
 * submit, not on every keystroke, so a mid-typing negative sign or partial
 * decimal never flashes an error.
 */
export function CoordinateInputForm({ onSubmit }: CoordinateInputFormProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const anchor = useUserDistanceAnchor();

  const [latText, setLatText] = useState("");
  const [lonText, setLonText] = useState("");
  const [latError, setLatError] = useState<CoordinateFieldError | null>(null);
  const [lonError, setLonError] = useState<CoordinateFieldError | null>(null);
  const [isPickingTown, setIsPickingTown] = useState(false);

  function handleSubmit() {
    const lat = validateLatitude(latText);
    const lon = validateLongitude(lonText);
    setLatError(lat.error);
    setLonError(lon.error);
    if (lat.value !== null && lon.value !== null) {
      onSubmit(lat.value, lon.value);
    }
  }

  function handleUseMyLocation() {
    if (!anchor.hasFix) {
      return;
    }
    setLatText(anchor.lat.toFixed(4));
    setLonText(anchor.lon.toFixed(4));
    setLatError(null);
    setLonError(null);
  }

  function handleSelectTown(lat: number, lon: number) {
    setLatText(lat.toFixed(4));
    setLonText(lon.toFixed(4));
    setLatError(null);
    setLonError(null);
    setIsPickingTown(false);
  }

  return (
    <View style={{ gap: spacing[3] }}>
      <Text
        accessibilityRole="header"
        style={{
          color: colors.text.primary,
          fontSize: typography.h3.fontSize,
          lineHeight: typography.h3.lineHeight,
          fontWeight: typography.h3.fontWeight,
        }}
      >
        {t("handbook.coordinates.sectionTitle")}
      </Text>

      <View style={{ gap: spacing[2] }}>
        <Text style={{ color: colors.text.secondary, fontSize: typography.bodyMeta.fontSize }}>
          {t("handbook.coordinates.latLabel")}
        </Text>
        <TextInput
          value={latText}
          onChangeText={(text) => {
            setLatText(text);
            setLatError(null);
          }}
          placeholder={t("handbook.coordinates.latPlaceholder")}
          placeholderTextColor={colors.text.tertiary}
          accessibilityLabel={t("handbook.coordinates.latLabel")}
          keyboardType="default"
          autoCorrect={false}
          style={[
            styles.input,
            {
              color: colors.text.primary,
              borderColor: latError ? colors.status.danger : colors.border.default,
              backgroundColor: colors.surface.raised,
              fontSize: typography.bodyDefault.fontSize,
              padding: spacing[3],
            },
          ]}
        />
        {latError ? (
          <Text accessibilityRole="alert" style={{ color: colors.status.danger, fontSize: typography.bodyMeta.fontSize }}>
            {t(fieldErrorKey(latError))}
          </Text>
        ) : null}
      </View>

      <View style={{ gap: spacing[2] }}>
        <Text style={{ color: colors.text.secondary, fontSize: typography.bodyMeta.fontSize }}>
          {t("handbook.coordinates.lonLabel")}
        </Text>
        <TextInput
          value={lonText}
          onChangeText={(text) => {
            setLonText(text);
            setLonError(null);
          }}
          placeholder={t("handbook.coordinates.lonPlaceholder")}
          placeholderTextColor={colors.text.tertiary}
          accessibilityLabel={t("handbook.coordinates.lonLabel")}
          keyboardType="default"
          autoCorrect={false}
          style={[
            styles.input,
            {
              color: colors.text.primary,
              borderColor: lonError ? colors.status.danger : colors.border.default,
              backgroundColor: colors.surface.raised,
              fontSize: typography.bodyDefault.fontSize,
              padding: spacing[3],
            },
          ]}
        />
        {lonError ? (
          <Text accessibilityRole="alert" style={{ color: colors.status.danger, fontSize: typography.bodyMeta.fontSize }}>
            {t(fieldErrorKey(lonError))}
          </Text>
        ) : null}
      </View>

      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          disabled={!anchor.hasFix}
          onPress={handleUseMyLocation}
          hitSlop={8}
        >
          <Text
            style={{
              color: anchor.hasFix ? colors.text.link : colors.text.tertiary,
              fontSize: typography.labelButton.fontSize,
              fontWeight: typography.labelButton.fontWeight,
            }}
          >
            {t("handbook.coordinates.useMyLocation")}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: isPickingTown }}
          onPress={() => setIsPickingTown((value) => !value)}
          hitSlop={8}
        >
          <Text
            style={{
              color: colors.text.link,
              fontSize: typography.labelButton.fontSize,
              fontWeight: typography.labelButton.fontWeight,
            }}
          >
            {isPickingTown ? t("handbook.coordinates.hidePickTown") : t("handbook.coordinates.pickTown")}
          </Text>
        </Pressable>
      </View>
      {!anchor.hasFix ? (
        <Text style={{ color: colors.text.tertiary, fontSize: typography.bodyMeta.fontSize }}>
          {t("handbook.coordinates.locationUnavailable")}
        </Text>
      ) : null}

      {isPickingTown ? (
        <View style={{ gap: spacing[2] }}>
          {GAZETTEER_CITIES.map((city) => (
            <Pressable
              key={city.id}
              accessibilityRole="button"
              onPress={() => handleSelectTown(city.lat, city.lon)}
              style={[styles.townRow, { borderColor: colors.border.default }]}
            >
              <Text style={{ color: colors.text.primary, fontSize: typography.bodyDefault.fontSize }}>
                {pickLocalizedName(city.names, i18n.language)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        onPress={handleSubmit}
        style={[styles.primaryButton, { backgroundColor: colors.brand.primary, paddingVertical: spacing[3] }]}
      >
        <Text
          style={{
            color: colors.brand.onPrimary,
            fontSize: typography.labelButton.fontSize,
            fontWeight: typography.labelButton.fontWeight,
          }}
        >
          {t("handbook.lookupButton")}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: 10,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  townRow: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingStart: 14,
    paddingEnd: 14,
  },
  primaryButton: {
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
});
