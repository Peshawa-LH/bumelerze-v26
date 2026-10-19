import Constants from "expo-constants";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/theme";

import {
  buildRecordingText,
  RECORDING_DURATIONS_MS,
  recordingFileName,
  summarizeRecording,
  type SensorRecording,
} from "../recording";
import { saveRecordingText } from "../save-recording";

interface RecordingPanelProps {
  recording: { startedAt: number; endsAt: number } | null;
  lastRecording: SensorRecording | null;
  onStart: (durationMs: number) => void;
  onStop: () => void;
  onDiscard: () => void;
}

function deviceLabel(): string {
  if (Platform.OS === "web") {
    return typeof navigator === "undefined" ? "web" : navigator.userAgent;
  }
  return `${Platform.OS} ${String(Platform.Version)}`;
}

function secondsLeftAt(endsAt: number): number {
  return Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
}

/**
 * Record a fixed window of the phone's accelerometer and hand it over as
 * a text file (recording.ts). Kept deliberately small: pick 10/30/60 s,
 * press Record, watch the countdown, save or discard.
 */
export function RecordingPanel({
  recording,
  lastRecording,
  onStart,
  onStop,
  onDiscard,
}: RecordingPanelProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [durationMs, setDurationMs] = useState<number>(RECORDING_DURATIONS_MS[1]);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">(
    "idle",
  );

  useEffect(() => {
    if (!recording) return undefined;
    const id = setInterval(() => setSecondsLeft(secondsLeftAt(recording.endsAt)), 250);
    return () => clearInterval(id);
  }, [recording]);

  const summary = lastRecording ? summarizeRecording(lastRecording) : null;

  async function handleSave() {
    if (!lastRecording) return;
    setSaveState("saving");
    try {
      const text = buildRecordingText(lastRecording, {
        appVersion: Constants.expoConfig?.version ?? "dev",
        platform: Platform.OS,
        device: deviceLabel(),
        locale: i18n.language,
      });
      await saveRecordingText(text, recordingFileName(lastRecording.startedAt));
      setSaveState("saved");
    } catch {
      setSaveState("failed");
    }
  }

  function handleStart() {
    setSaveState("idle");
    setSecondsLeft(durationMs / 1000);
    onStart(durationMs);
  }

  function handleDiscard() {
    setSaveState("idle");
    onDiscard();
  }

  const label = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;
  const button = (pressed: boolean, filled: boolean) => [
    styles.button,
    {
      backgroundColor: filled ? colors.brand.primary : "transparent",
      borderColor: colors.brand.primary,
      opacity: pressed ? 0.85 : 1,
      paddingVertical: spacing[2],
      paddingHorizontal: spacing[4],
    },
  ];
  const buttonText = (filled: boolean) => ({
    color: filled ? colors.brand.onPrimary : colors.brand.primary,
    fontSize: typography.labelButton.fontSize,
    fontWeight: typography.labelButton.fontWeight,
  });

  return (
    <View
      style={[
        styles.panel,
        { borderColor: colors.border.subtle, padding: spacing[3], gap: spacing[2] },
      ]}
    >
      <Text
        style={{
          color: colors.text.primary,
          fontSize: typography.h3.fontSize,
          lineHeight: typography.h3.lineHeight,
          fontWeight: typography.h3.fontWeight,
        }}
      >
        {t("sensor.recording.title")}
      </Text>
      <Text style={label}>{t("sensor.recording.hint")}</Text>

      {recording ? (
        <View style={[styles.row, { gap: spacing[3] }]}>
          <Text
            accessibilityLiveRegion="polite"
            style={{
              color: colors.status.danger,
              fontSize: typography.h3.fontSize,
              fontWeight: "700",
            }}
          >
            {t("sensor.recording.countdown", { seconds: secondsLeft })}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onStop}
            style={({ pressed }) => button(pressed, false)}
          >
            <Text style={buttonText(false)}>{t("sensor.recording.stop")}</Text>
          </Pressable>
        </View>
      ) : summary ? (
        <View style={{ gap: spacing[2] }}>
          <Text style={label}>
            {t("sensor.recording.summary", {
              seconds: summary.durationS.toFixed(1),
              count: summary.count,
              hz: summary.measuredHz.toFixed(1),
              peak: summary.peakLinearG.toFixed(3),
            })}
          </Text>
          <View style={[styles.row, { gap: spacing[2] }]}>
            <Pressable
              accessibilityRole="button"
              onPress={() => void handleSave()}
              disabled={saveState === "saving"}
              style={({ pressed }) => button(pressed, true)}
            >
              <Text style={buttonText(true)}>
                {t(
                  saveState === "saved"
                    ? "sensor.recording.saved"
                    : "sensor.recording.save",
                )}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={handleDiscard}
              style={({ pressed }) => button(pressed, false)}
            >
              <Text style={buttonText(false)}>{t("sensor.recording.discard")}</Text>
            </Pressable>
          </View>
          {saveState === "failed" ? (
            <Text
              accessibilityRole="alert"
              style={{ ...label, color: colors.status.danger }}
            >
              {t("sensor.recording.saveFailed")}
            </Text>
          ) : null}
        </View>
      ) : (
        <View style={[styles.row, { gap: spacing[2] }]}>
          <View accessibilityRole="radiogroup" style={[styles.row, { gap: spacing[1] }]}>
            {RECORDING_DURATIONS_MS.map((ms) => {
              const selected = ms === durationMs;
              return (
                <Pressable
                  key={ms}
                  accessibilityRole="radio"
                  accessibilityState={{ selected, checked: selected }}
                  onPress={() => setDurationMs(ms)}
                  style={[
                    styles.chip,
                    {
                      borderColor: selected
                        ? colors.brand.primary
                        : colors.border.default,
                      backgroundColor: selected ? colors.brand.primary : "transparent",
                      paddingHorizontal: spacing[3],
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: selected ? colors.brand.onPrimary : colors.text.primary,
                      fontSize: typography.labelCaption.fontSize,
                      fontWeight: "600",
                    }}
                  >
                    {t("sensor.recording.duration", { seconds: ms / 1000 })}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={handleStart}
            style={({ pressed }) => button(pressed, true)}
          >
            <Text style={buttonText(true)}>{t("sensor.recording.start")}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderWidth: 1, borderRadius: 12 },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  button: {
    borderWidth: 1.5,
    borderRadius: 999,
    minHeight: 44,
    justifyContent: "center",
  },
  chip: { borderWidth: 1.5, borderRadius: 999, minHeight: 36, justifyContent: "center" },
});
