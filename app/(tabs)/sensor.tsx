import { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  ChannelLegend,
  type SensorView,
  SpaceView,
  TraceStack,
  useAccelerometerStream,
  ViewSwitch,
} from "@/features/sensor";
import { StationsPanel } from "@/features/stations";
import { useTheme } from "@/theme";

/**
 * Sensor screen (spec-v1.md §4.8) — the MyShake-style "your phone is a
 * seismometer" wow-feature. Display-only in v1 (feature-matrix A6:
 * record/replay is v1.5, background triggering is v2+ research — neither
 * exists here). Client-only: no backend, no network dependency, no location.
 */
type SensorMode = "phone" | "stations";
const SENSOR_MODES: readonly SensorMode[] = ["phone", "stations"];

export default function SensorScreen() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();

  const { status, samples, frameAt, requestWebPermission } = useAccelerometerStream();
  const [view, setView] = useState<SensorView>("traces");
  const [mode, setMode] = useState<SensorMode>("phone");
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

      {/* Two modes of one tab (owner, 2026-09-27: the stations view stays
          inside the Sensor tab, bottom tabs in place, no pushed screen). */}
      <View
        accessibilityRole="tablist"
        style={[
          styles.modeTrack,
          { backgroundColor: colors.surface.sunken, borderColor: colors.border.subtle },
        ]}
      >
        {SENSOR_MODES.map((option) => {
          const selected = option === mode;
          const fg = selected ? colors.brand.onPrimary : colors.text.secondary;
          return (
            <Pressable
              key={option}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={t(`sensor.mode.${option}`)}
              onPress={() => setMode(option)}
              style={[
                styles.modeOption,
                {
                  backgroundColor: selected ? colors.brand.primary : "transparent",
                  paddingVertical: spacing[2],
                },
              ]}
            >
              <Text
                style={{
                  color: fg,
                  fontSize: typography.labelButton.fontSize,
                  fontWeight: typography.labelButton.fontWeight,
                }}
              >
                {t(`sensor.mode.${option}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {mode === "stations" ? <StationsPanel /> : null}

      {mode === "phone" ? (
        <Text
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
          }}
        >
          {t("sensor.phone.lead")}
        </Text>
      ) : null}

      {mode === "phone" && status === "checking" ? (
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

      {mode === "phone" && status === "desktop" ? (
        <Text
          accessibilityRole="alert"
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
          }}
        >
          {t("sensor.web.desktop")}
        </Text>
      ) : null}

      {(mode === "phone" && status === "unavailable") ||
      status === "permission-denied" ? (
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

      {mode === "phone" && status === "permission-required" ? (
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

      {mode === "phone" && status === "streaming" ? (
        <View style={{ gap: spacing[3] }}>
          <ViewSwitch value={view} onChange={setView} />
          <ChannelLegend />

          {view === "traces" ? (
            <TraceStack
              samples={samples}
              frameAt={frameAt}
              accessibilityLabel={t("sensor.chartA11yLabel")}
            />
          ) : (
            <SpaceView
              samples={samples}
              frameAt={frameAt}
              accessibilityLabel={t("sensor.spaceA11yLabel")}
            />
          )}

          <Text
            style={{
              color: colors.text.tertiary,
              fontSize: typography.bodyMeta.fontSize,
              lineHeight: typography.bodyMeta.lineHeight,
            }}
          >
            {t("sensor.motionNote")}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  modeTrack: {
    flexDirection: "row",
    borderRadius: 999,
    borderWidth: 1,
    padding: 3,
  },
  modeOption: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    minHeight: 44,
  },
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
