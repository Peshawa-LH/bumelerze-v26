import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  AxisToggleChips,
  SeismogramChart,
  useAccelerometerStream,
} from "@/features/sensor";
import { useTheme } from "@/theme";

/**
 * Sensor screen (spec-v1.md §4.8) — the MyShake-style "your phone is a
 * seismometer" wow-feature. Display-only in v1 (feature-matrix A6:
 * record/replay is v1.5, background triggering is v2+ research — neither
 * exists here). Client-only: no backend, no network dependency, no location.
 */
export default function SensorScreen() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();

  const {
    status,
    samples,
    activeAxes,
    toggleAxis,
    removeGravity,
    setRemoveGravity,
    requestWebPermission,
  } = useAccelerometerStream();
  const isWeb = Platform.OS === "web";

  return (
    <ScrollView
      style={{ backgroundColor: colors.surface.base }}
      contentContainerStyle={{
        paddingTop: insets.top + spacing[6],
        paddingBottom: insets.bottom + spacing[6],
        paddingStart: spacing[4],
        paddingEnd: spacing[4],
        gap: spacing[4],
      }}
    >
      <Text
        accessibilityRole="header"
        style={{
          color: colors.text.primary,
          fontSize: typography.h1.fontSize,
          lineHeight: typography.h1.lineHeight,
          fontWeight: typography.h1.fontWeight,
        }}
      >
        {t("sensor.title")}
      </Text>

      <View style={{ gap: spacing[2] }}>
        <Text
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
          }}
        >
          {t("sensor.explainer.sentence1")}
        </Text>
        <Text
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
          }}
        >
          {t("sensor.explainer.sentence2")}
        </Text>
        <Text
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
          }}
        >
          {t("sensor.explainer.sentence3")}
        </Text>
      </View>

      {status === "checking" ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[3] }}>
          <ActivityIndicator color={colors.brand.primary} />
          <Text
            style={{
              color: colors.text.secondary,
              fontSize: typography.bodyDefault.fontSize,
              lineHeight: typography.bodyDefault.lineHeight,
              flexShrink: 1,
            }}
          >
            {t("sensor.checking")}
          </Text>
        </View>
      ) : null}

      {status === "unavailable" || status === "permission-denied" ? (
        <Text
          accessibilityRole="alert"
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
          }}
        >
          {isWeb
            ? t("sensor.web.explanation")
            : t(
                status === "unavailable"
                  ? "sensor.unavailable"
                  : "sensor.permissionDenied",
              )}
        </Text>
      ) : null}

      {status === "permission-required" ? (
        <View style={{ gap: spacing[3] }}>
          <Text
            style={{
              color: colors.text.secondary,
              fontSize: typography.bodyDefault.fontSize,
              lineHeight: typography.bodyDefault.lineHeight,
            }}
          >
            {t("sensor.web.enableHint")}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={requestWebPermission}
            style={({ pressed }) => [
              styles.enableButton,
              {
                backgroundColor: colors.brand.primary,
                opacity: pressed ? 0.85 : 1,
                paddingVertical: spacing[3],
              },
            ]}
          >
            <Text
              style={{
                color: colors.brand.onPrimary,
                fontSize: typography.h3.fontSize,
                lineHeight: typography.h3.lineHeight,
                fontWeight: typography.labelButton.fontWeight,
              }}
            >
              {t("sensor.web.enableButton")}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {status === "streaming" ? (
        <View style={{ gap: spacing[3] }}>
          <AxisToggleChips activeAxes={activeAxes} onToggle={toggleAxis} />

          <SeismogramChart
            samples={samples}
            activeAxes={activeAxes}
            accessibilityLabel={t("sensor.chartA11yLabel")}
          />

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: spacing[3],
            }}
          >
            <Text
              style={{
                color: colors.text.primary,
                fontSize: typography.bodyDefault.fontSize,
                lineHeight: typography.bodyDefault.lineHeight,
                flexShrink: 1,
              }}
            >
              {t("sensor.gravityToggle")}
            </Text>
            <Switch
              value={removeGravity}
              onValueChange={setRemoveGravity}
              accessibilityRole="switch"
              accessibilityLabel={t("sensor.gravityToggle")}
              trackColor={{ true: colors.brand.primary }}
            />
          </View>

          <Text
            style={{
              color: colors.text.tertiary,
              fontSize: typography.bodyMeta.fontSize,
              lineHeight: typography.bodyMeta.lineHeight,
            }}
          >
            {t("sensor.gravityNote")}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // Deliberately larger than the app's usual 48dp primary-button floor —
  // this is the one button on this screen a panicked user has to find and
  // tap correctly on a small, low-end Android or an old iPhone before the
  // sensor can do anything at all.
  enableButton: {
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 56,
  },
});
