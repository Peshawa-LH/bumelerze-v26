import * as Location from "expo-location";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { GAZETTEER_CITIES, pickLocalizedName } from "@/features/geo";
import { useUserDistanceAnchor } from "@/features/location";
import { directionProps, directionStyle } from "@/i18n";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";
import {
  type CoordinateFieldError,
  validateLatitude,
  validateLongitude,
} from "../coordinate-validation";
import { MapCoordinatePicker } from "./MapCoordinatePicker";

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

type LocationRequest = "idle" | "asking" | "denied";

/**
 * Asks the platform for one foreground fix, prompting for permission when
 * it has not been decided yet (the browser prompt on web). Must run from a
 * tap handler so the system prompt follows a user action. Returns null on
 * a refusal or any platform failure.
 */
async function requestDeviceFix(): Promise<{ lat: number; lon: number } | null> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      return null;
    }
    const cached = await Location.getLastKnownPositionAsync();
    const position =
      cached ??
      (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    if (!position) {
      return null;
    }
    return { lat: position.coords.latitude, lon: position.coords.longitude };
  } catch {
    return null;
  }
}

/**
 * Coordinate entry (the v1 spec §7): decimal-degrees text inputs, a "use my
 * location" button, an optional gazetteer town picker and the map picker.
 * Validation runs on submit, not on every keystroke, so a mid-typing
 * negative sign or partial decimal never flashes an error.
 *
 * "Use my location" asks for the fix when tapped (B-18): it used to be
 * greyed out on every fresh web visit, with the "Location isn't available"
 * note shown unprompted, because it only ever copied a fix the Settings
 * screen had already obtained. Now a tap prompts the browser or phone, a
 * known fix (`useUserDistanceAnchor`) is still used instantly without a
 * prompt, and the note appears only after a refusal.
 *
 * The fields show the reader's own digits: a fix or a picked town fills
 * them in the locale's digits (Eastern Arabic-Indic in Sorani and Arabic,
 * matching the placeholders), and `coordinate-validation.ts` accepts those
 * digits on submit. The inputs follow the app language's direction so a
 * typed value sits under its label on the reading side (B-7).
 */
export function CoordinateInputForm({ onSubmit }: CoordinateInputFormProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const anchor = useUserDistanceAnchor();
  const locale = i18n.language;
  const dirProps = directionProps(locale);
  const dirStyle = directionStyle(locale);

  const [latText, setLatText] = useState("");
  const [lonText, setLonText] = useState("");
  const [latError, setLatError] = useState<CoordinateFieldError | null>(null);
  const [lonError, setLonError] = useState<CoordinateFieldError | null>(null);
  const [isPickingTown, setIsPickingTown] = useState(false);
  const [locationRequest, setLocationRequest] = useState<LocationRequest>("idle");

  function fillCoordinates(lat: number, lon: number) {
    setLatText(localizeDigits(lat.toFixed(4), locale));
    setLonText(localizeDigits(lon.toFixed(4), locale));
    setLatError(null);
    setLonError(null);
  }

  function handleSubmit() {
    const lat = validateLatitude(latText);
    const lon = validateLongitude(lonText);
    setLatError(lat.error);
    setLonError(lon.error);
    if (lat.value !== null && lon.value !== null) {
      onSubmit(lat.value, lon.value);
    }
  }

  async function handleUseMyLocation() {
    if (anchor.hasFix) {
      fillCoordinates(anchor.lat, anchor.lon);
      return;
    }
    setLocationRequest("asking");
    const fix = await requestDeviceFix();
    if (fix) {
      fillCoordinates(fix.lat, fix.lon);
      setLocationRequest("idle");
    } else {
      setLocationRequest("denied");
    }
  }

  function handleSelectTown(lat: number, lon: number) {
    fillCoordinates(lat, lon);
    setIsPickingTown(false);
  }

  // Best-effort parse of whatever is currently in the text fields, purely
  // to give the map picker a sensible initial view (`MapCoordinatePicker`'s
  // own doc comment) — errors are ignored here on purpose: a mid-typing
  // invalid value should never block opening the map, it should just fall
  // back to the map's own Kurdistan default view.
  const parsedInitialLat = validateLatitude(latText).value;
  const parsedInitialLon = validateLongitude(lonText).value;

  const inputStyle = [
    styles.input,
    {
      color: colors.text.primary,
      backgroundColor: colors.surface.raised,
      fontSize: typography.bodyDefault.fontSize,
      padding: spacing[3],
      ...dirStyle,
    },
  ];

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
          testID="handbook-lat-input"
          {...dirProps}
          style={[
            ...inputStyle,
            { borderColor: latError ? colors.status.danger : colors.border.default },
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
          testID="handbook-lon-input"
          {...dirProps}
          style={[
            ...inputStyle,
            { borderColor: lonError ? colors.status.danger : colors.border.default },
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
          accessibilityState={{ busy: locationRequest === "asking" }}
          disabled={locationRequest === "asking"}
          onPress={() => void handleUseMyLocation()}
          hitSlop={8}
        >
          <Text
            style={{
              color: locationRequest === "asking" ? colors.text.tertiary : colors.text.link,
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
        <MapCoordinatePicker
          initialLat={parsedInitialLat}
          initialLon={parsedInitialLon}
          onSelect={fillCoordinates}
        />
      </View>
      {locationRequest === "denied" ? (
        <Text
          accessibilityLiveRegion="polite"
          testID="handbook-location-denied"
          style={{ color: colors.text.tertiary, fontSize: typography.bodyMeta.fontSize }}
        >
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
    // `flexWrap` + a matching `gap` (not `justifyContent: "space-between"`
    // alone): a third action (the map picker) joined "Use my location" and
    // "Pick a town instead" here, and long Sorani/Arabic labels at 200%
    // font scale need to be able to drop to a second line instead of
    // clipping or overflowing the row's own width.
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: 16,
    rowGap: 8,
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
