import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { gazetteerPlaceById, placeDisplayName, usePlaceIndex } from "@/features/geo";
import { isolateName } from "@/features/geo/place-detail";
import { usePrefsStore } from "@/features/onboarding";
import { useTheme } from "@/theme";

import { useAlertPreferencesPayload } from "../prefs-sync";
import { SupabaseAlertsTransport, toAlertsError, type AlertsTransport } from "../transport";
import type { AlertAccess, AlertsErrorCode } from "../types";
import { useWebPushDevice } from "../use-web-push-device";
import { browserEnv, ensureWebAppManifest, webBase, type BrowserEnv } from "../web-push";

/**
 * The real alert controls, shown only to testers (or everyone once the
 * rollout is public): turn alerts on for THIS device (web push), where "near
 * me" is, and a test alert through the real sender. The tiers and places
 * themselves stay in the screen below, unchanged.
 */
export function AlertsTesterPanel({
  access,
  transport = SupabaseAlertsTransport,
  env,
}: {
  access: AlertAccess;
  transport?: AlertsTransport;
  /** Test seam: the browser objects (null = no browser). */
  env?: BrowserEnv | null;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const device = useWebPushDevice(transport, env);
  const payload = useAlertPreferencesPayload();
  const referencePlace = usePrefsStore((state) => state.referencePlace);
  const index = usePlaceIndex();
  const [testState, setTestState] = useState<"idle" | "busy" | "sent" | AlertsErrorCode>("idle");

  const resolvedEnv = useMemo(() => (env === undefined ? browserEnv() : env), [env]);
  useEffect(() => {
    if (Platform.OS === "web" && resolvedEnv) {
      ensureWebAppManifest(resolvedEnv, webBase());
    }
  }, [resolvedEnv]);

  const body = {
    color: colors.text.primary,
    fontSize: typography.bodyDefault.fontSize,
    lineHeight: typography.bodyDefault.lineHeight,
  } as const;
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  let placeName: string | null = null;
  if (payload.nearMeLat !== null && referencePlace) {
    const place = index?.byId.get(referencePlace.placeId) ?? gazetteerPlaceById(referencePlace.placeId);
    placeName = isolateName(place ? placeDisplayName(place, i18n.language) : referencePlace.placeId);
  }

  async function sendTest() {
    setTestState("busy");
    try {
      await transport.sendTest();
      setTestState("sent");
    } catch (error) {
      setTestState(toAlertsError(error).code);
    }
  }

  const testText =
    testState === "sent"
      ? t("alerts.test.sent")
      : testState === "too_soon"
        ? t("alerts.test.tooSoon")
        : testState === "no_device"
          ? t("alerts.test.noDevice")
          : testState === "idle" || testState === "busy"
            ? null
            : t("alerts.device.failed");

  return (
    <View style={{ gap: spacing[3] }} testID="alerts-tester-panel">
      {access.tester ? (
        <View style={[styles.row, { gap: spacing[2] }]}>
          <View
            testID="alerts-tester-chip"
            style={[
              styles.chip,
              { borderColor: colors.brand.primary, paddingHorizontal: spacing[2] },
            ]}
          >
            <Text style={{ color: colors.brand.primary, fontSize: typography.labelCaption.fontSize, fontWeight: "700" }}>
              {t("alerts.testerChip")}
            </Text>
          </View>
        </View>
      ) : null}
      {access.tester ? <Text style={meta}>{t("alerts.testerIntro")}</Text> : null}
      {access.mode === "off" ? (
        <Text style={[meta, { color: colors.status.danger }]} testID="alerts-paused">
          {t("alerts.paused")}
        </Text>
      ) : null}

      <View
        testID="alerts-device"
        style={[
          styles.card,
          {
            backgroundColor: colors.surface.raised,
            borderColor: colors.border.default,
            padding: spacing[4],
            gap: spacing[2],
          },
        ]}
      >
        <Text accessibilityRole="header" style={[body, { fontWeight: "700" }]}>
          {t("alerts.device.title")}
        </Text>
        <DeviceBody device={device} />
      </View>

      <Text style={meta} testID="alerts-near-me-where">
        {placeName ? t("alerts.nearMeWhere", { place: placeName }) : t("alerts.nearMeNoPlace")}
      </Text>

      <PanelButton
        label={t("alerts.test.button")}
        onPress={() => void sendTest()}
        disabled={testState === "busy"}
        testID="alerts-send-test"
      />
      {testText ? (
        <Text style={meta} accessibilityLiveRegion="polite" testID="alerts-test-result">
          {testText}
        </Text>
      ) : null}
    </View>
  );
}

function DeviceBody({ device }: { device: ReturnType<typeof useWebPushDevice> }) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  const supportText: Record<string, string> = {
    native: t("alerts.device.native"),
    "not-configured": t("alerts.device.notConfigured"),
    unsupported: t("alerts.device.unsupported"),
    "ios-home-screen": t("alerts.device.iosHomeScreen"),
  };
  if (device.support !== "supported") {
    return (
      <Text style={meta} testID={`alerts-device-${device.support}`}>
        {supportText[device.support]}
      </Text>
    );
  }
  if (device.status === "checking") {
    return <ActivityIndicator />;
  }
  const errorText =
    device.error === "denied"
      ? t("alerts.device.denied")
      : device.error === "too_many_devices"
        ? t("alerts.device.tooMany")
        : device.error
          ? t("alerts.device.failed")
          : null;
  const on = device.status === "on";
  return (
    <>
      <Text style={meta} testID="alerts-device-status">
        {device.busy ? t("alerts.device.working") : on ? t("alerts.device.on") : t("alerts.device.off")}
      </Text>
      <PanelButton
        label={on ? t("alerts.device.turnOff") : t("alerts.device.turnOn")}
        onPress={() => void (on ? device.disable() : device.enable())}
        disabled={device.busy}
        testID={on ? "alerts-device-off" : "alerts-device-on"}
      />
      {errorText ? (
        <Text
          accessibilityRole="alert"
          style={{ color: colors.status.danger, fontSize: typography.bodyMeta.fontSize }}
          testID="alerts-device-error"
        >
          {errorText}
        </Text>
      ) : null}
    </>
  );
}

function PanelButton({
  label,
  onPress,
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID: string;
}) {
  const { colors, typography, spacing } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled ?? false }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={[
        styles.button,
        {
          borderColor: colors.border.default,
          paddingVertical: spacing[3],
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Text
        style={{
          color: colors.text.primary,
          fontSize: typography.bodyDefault.fontSize,
          fontWeight: "600",
          textAlign: "center",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  chip: { borderWidth: 1, borderRadius: 999, minHeight: 24, justifyContent: "center" },
  card: { borderWidth: 1, borderRadius: 12 },
  button: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 48,
    paddingStart: 16,
    paddingEnd: 16,
    alignItems: "center",
    justifyContent: "center",
  },
});
