import { useQueryClient } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import type { TFunction } from "i18next";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { formatDateOnly } from "@/features/events";
import { formatIntegerLocalized } from "@/lib/format-numbers";
import { useTheme, nativeFontFamily, READING_START } from "@/theme";

import { useMyAlertDevices } from "../queries";
import { SupabaseAlertsTransport, toAlertsError, type AlertsTransport } from "../transport";
import type { AlertAccess, AlertDevice, AlertsErrorCode } from "../types";
import { useExpoPushDevice, type PhoneDeviceOptions, type PushDevice } from "../use-expo-push-device";
import { useWebPushDevice } from "../use-web-push-device";
import {
  browserEnv,
  ensureWebAppManifest,
  isIosDevice,
  webBase,
  type BrowserEnv,
} from "../web-push";

/**
 * The real alert controls, shown only to testers (or everyone once the
 * rollout is public). Review note 11.5: one big status line a person in a
 * hurry can read at a glance (on / off / not possible here, and why), ONE
 * primary action, then the test alert and the list of this account's
 * devices. The tiers and places stay in the screen below.
 *
 * The web app registers this browser (web push); the iOS/Android app
 * registers the phone (Expo push, use-expo-push-device.ts). Each hook does
 * nothing on the other platform.
 */
export function AlertsTesterPanel({
  access,
  transport = SupabaseAlertsTransport,
  env,
  phone,
}: {
  access: AlertAccess;
  transport?: AlertsTransport;
  /** Test seam: the browser objects (null = no browser). */
  env?: BrowserEnv | null;
  /** Test seam: the phone's project id and native calls. */
  phone?: PhoneDeviceOptions;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const webDevice = useWebPushDevice(transport, env);
  const phoneDevice = useExpoPushDevice(transport, phone);
  const isWeb = Platform.OS === "web";
  const device: PushDevice = isWeb ? { ...webDevice, subscriptionId: null } : phoneDevice;

  const resolvedEnv = useMemo(() => (env === undefined ? browserEnv() : env), [env]);
  const ios = resolvedEnv ? isIosDevice(resolvedEnv.navigator) : false;
  // The manifest (and a theme-color in the app's own background colour, so
  // Safari never paints its bars in the manifest's red) live only while this
  // panel is on screen; the cleanup removes them again (review note 11.2).
  const themeColor = colors.surface.base;
  useEffect(() => {
    if (Platform.OS === "web" && resolvedEnv) {
      return ensureWebAppManifest(resolvedEnv, webBase(), themeColor);
    }
    return undefined;
  }, [resolvedEnv, themeColor]);

  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    fontFamily: nativeFontFamily(typography.bodyMeta),
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  return (
    <View style={{ gap: spacing[4] }} testID="alerts-tester-panel">
      {access.tester ? (
        <View style={{ gap: spacing[2] }}>
          <View style={styles.row}>
            <View
              testID="alerts-tester-chip"
              style={[styles.chip, { borderColor: colors.brand.primary, paddingHorizontal: spacing[2] }]}
            >
              <Text
                style={{
                  color: colors.brand.primary,
                  fontSize: typography.labelCaption.fontSize,
                  fontFamily: nativeFontFamily(typography.labelCaption, "700"),
                  ...READING_START,
                  fontWeight: "700",
                }}
              >
                {t("alerts.testerChip")}
              </Text>
            </View>
          </View>
          <Text style={meta}>{t("alerts.testerIntro")}</Text>
        </View>
      ) : null}
      {access.mode === "off" ? (
        <Text style={[meta, { color: colors.status.danger }]} testID="alerts-paused">
          {t("alerts.paused")}
        </Text>
      ) : null}

      <Card testID="alerts-device">
        <DeviceStatus device={device} ios={ios} phoneApp={!isWeb} />
      </Card>

      <TestAlert transport={transport} />

      <DeviceList allowed={access.enabled} transport={transport} device={device} />
    </View>
  );
}

// ------------------------------------------------------------- pieces

function Card({ children, testID }: { children: React.ReactNode; testID: string }) {
  const { colors, spacing } = useTheme();
  return (
    <View
      testID={testID}
      style={[
        styles.card,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[4],
          gap: spacing[3],
        },
      ]}
    >
      {children}
    </View>
  );
}

type Tone = "on" | "off" | "warning";

/** The one big line: a coloured dot and a short sentence. */
function StatusLine({ tone, text, testID }: { tone: Tone; text: string; testID: string }) {
  const { colors, typography, spacing } = useTheme();
  const dot =
    tone === "on" ? colors.status.success : tone === "warning" ? colors.status.warning : colors.text.tertiary;
  return (
    <View style={[styles.row, { gap: spacing[2] }]} accessibilityRole="header">
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <Text
        testID={testID}
        style={{
          flex: 1,
          color: colors.text.primary,
          fontSize: typography.h3.fontSize,
          fontFamily: nativeFontFamily(typography.h3, "700"),
          ...READING_START,
          lineHeight: typography.h3.lineHeight,
          fontWeight: "700",
        }}
      >
        {text}
      </Text>
    </View>
  );
}

function Body({ children, testID }: { children: React.ReactNode; testID?: string }) {
  const { colors, typography } = useTheme();
  return (
    <Text
      testID={testID}
      style={{
        color: colors.text.secondary,
        fontSize: typography.bodyDefault.fontSize,
        fontFamily: nativeFontFamily(typography.bodyDefault),
        ...READING_START,
        lineHeight: typography.bodyDefault.lineHeight,
      }}
    >
      {children}
    </Text>
  );
}

function ErrorText({ text }: { text: string }) {
  const { colors, typography } = useTheme();
  return (
    <Text
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        color: colors.status.danger,
        fontSize: typography.bodyDefault.fontSize,
        fontFamily: nativeFontFamily(typography.bodyDefault),
        ...READING_START,
        lineHeight: typography.bodyDefault.lineHeight,
      }}
      testID="alerts-device-error"
    >
      {text}
    </Text>
  );
}

/** A failure, as one plain sentence. */
export function deviceErrorText(code: AlertsErrorCode, t: TFunction, ios: boolean): string {
  switch (code) {
    case "denied":
      return ios ? t("alerts.device.deniedIos") : t("alerts.device.deniedBrowser");
    case "dismissed":
      return t("alerts.device.dismissed");
    case "too_many_devices":
      return t("alerts.device.tooMany");
    case "network":
      return t("alerts.device.network");
    case "browser":
      return t("alerts.device.browserFailed");
    case "not_enabled":
      return t("alerts.device.notEnabled");
    default:
      return t("alerts.device.failed");
  }
}

function DeviceStatus({
  device,
  ios,
  phoneApp,
}: {
  device: PushDevice;
  ios: boolean;
  /** The iOS/Android app (Expo push), not a browser. */
  phoneApp: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();

  if (device.support === "ios-browser") {
    const steps = [
      t("alerts.device.iosStep1"),
      t("alerts.device.iosStep2"),
      t("alerts.device.iosStep3"),
      t("alerts.device.iosStep4"),
    ];
    return (
      <View style={{ gap: spacing[3] }} testID="alerts-device-ios-browser">
        <StatusLine tone="warning" text={t("alerts.device.iosBrowserTitle")} testID="alerts-device-status" />
        <Body>{t("alerts.device.iosBrowserWhy")}</Body>
        <View style={{ gap: spacing[2] }}>
          {steps.map((step, index) => (
            <View key={step} style={[styles.stepRow, { gap: spacing[2] }]}>
              <View style={[styles.stepNumber, { backgroundColor: colors.brand.primary }]}>
                <Text style={{ color: colors.brand.onPrimary, fontSize: typography.bodyMeta.fontSize, fontFamily: nativeFontFamily(typography.bodyMeta, "700"), ...READING_START, fontWeight: "700" }}>
                  {formatIntegerLocalized(index + 1, i18n.language)}
                </Text>
              </View>
              <Text
                style={{
                  flex: 1,
                  color: colors.text.primary,
                  fontSize: typography.bodyDefault.fontSize,
                  fontFamily: nativeFontFamily(typography.bodyDefault),
                  ...READING_START,
                  lineHeight: typography.bodyDefault.lineHeight,
                }}
              >
                {step}
              </Text>
            </View>
          ))}
        </View>
      </View>
    );
  }

  if (device.support !== "supported") {
    const reason: Record<Exclude<PushDevice["support"], "supported" | "ios-browser">, string> = {
      native: t("alerts.device.native"),
      "not-configured": t("alerts.device.notConfigured"),
      unsupported: t("alerts.device.unsupported"),
      "ios-update": t("alerts.device.iosUpdate"),
    };
    return (
      <View style={{ gap: spacing[2] }}>
        <StatusLine tone="warning" text={t("alerts.device.notPossible")} testID="alerts-device-status" />
        <Body testID={`alerts-device-${device.support}`}>{reason[device.support]}</Body>
      </View>
    );
  }

  if (device.status === "checking") {
    return <ActivityIndicator />;
  }

  const on = device.status === "on";
  if (!on && device.permission === "denied" && phoneApp) {
    // The phone will not ask again either, but the app can open its page in
    // Settings: one button that does that.
    return (
      <View style={{ gap: spacing[3] }} testID="alerts-device-denied">
        <StatusLine tone="warning" text={t("alerts.device.blocked")} testID="alerts-device-status" />
        <Body>{t("alerts.device.deniedApp")}</Body>
        <ActionButton
          primary
          label={t("notificationSettings.permission.openSettings")}
          onPress={() => void Linking.openSettings()}
          testID="alerts-device-open-settings"
        />
      </View>
    );
  }
  if (!on && device.permission === "denied") {
    // No button: the browser will not ask again; only its settings can.
    return (
      <View style={{ gap: spacing[2] }} testID="alerts-device-denied">
        <StatusLine tone="warning" text={t("alerts.device.blocked")} testID="alerts-device-status" />
        <Body>{ios ? t("alerts.device.deniedIos") : t("alerts.device.deniedBrowser")}</Body>
      </View>
    );
  }

  const error = device.error && device.error !== "denied" ? deviceErrorText(device.error, t, ios) : null;
  return (
    <View style={{ gap: spacing[3] }}>
      <StatusLine
        tone={on ? "on" : "off"}
        text={device.busy ? t("alerts.device.working") : on ? t("alerts.device.on") : t("alerts.device.off")}
        testID="alerts-device-status"
      />
      <Body>{on ? t("alerts.device.onHint") : t("alerts.device.offHint")}</Body>
      <ActionButton
        primary={!on}
        label={on ? t("alerts.device.turnOff") : t("alerts.device.turnOn")}
        onPress={() => void (on ? device.disable() : device.enable())}
        disabled={device.busy}
        testID={on ? "alerts-device-off" : "alerts-device-on"}
      />
      {error ? <ErrorText text={error} /> : null}
    </View>
  );
}

function TestAlert({ transport }: { transport: AlertsTransport }) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const [state, setState] = useState<"idle" | "busy" | "sent" | AlertsErrorCode>("idle");

  async function send() {
    setState("busy");
    try {
      await transport.sendTest();
      setState("sent");
    } catch (error) {
      setState(toAlertsError(error).code);
    }
  }

  const result =
    state === "sent"
      ? t("alerts.test.sent")
      : state === "too_soon"
        ? t("alerts.test.tooSoon")
        : state === "no_device"
          ? t("alerts.test.noDevice")
          : state === "network"
            ? t("alerts.device.network")
            : state === "idle" || state === "busy"
              ? null
              : t("alerts.device.failed");

  return (
    <Card testID="alerts-test">
      <Text
        accessibilityRole="header"
        style={{
          color: colors.text.primary,
          fontSize: typography.h3.fontSize,
          fontFamily: nativeFontFamily(typography.h3),
          ...READING_START,
          lineHeight: typography.h3.lineHeight,
          fontWeight: typography.h3.fontWeight,
        }}
      >
        {t("alerts.test.title")}
      </Text>
      <Body>{t("alerts.test.explainer")}</Body>
      <ActionButton
        label={state === "busy" ? t("alerts.device.working") : t("alerts.test.button")}
        onPress={() => void send()}
        disabled={state === "busy"}
        testID="alerts-send-test"
      />
      {result ? (
        <Text
          accessibilityLiveRegion="polite"
          testID="alerts-test-result"
          style={{
            color: state === "sent" ? colors.text.primary : colors.status.danger,
            fontSize: typography.bodyDefault.fontSize,
            fontFamily: nativeFontFamily(typography.bodyDefault),
            ...READING_START,
            lineHeight: typography.bodyDefault.lineHeight,
          }}
        >
          {result}
        </Text>
      ) : null}
    </Card>
  );
}

/** The push service behind an endpoint, as a name a person recognises. */
export function deviceKindLabel(device: Pick<AlertDevice, "kind" | "endpoint">, t: TFunction): string {
  if (device.kind === "expo") {
    return t("alerts.devices.phoneApp");
  }
  let host = "";
  try {
    host = new URL(device.endpoint ?? "").hostname;
  } catch {
    host = "";
  }
  if (host === "fcm.googleapis.com") return t("alerts.devices.chrome");
  if (host.endsWith(".push.apple.com")) return t("alerts.devices.safari");
  if (host.endsWith("mozilla.com")) return t("alerts.devices.firefox");
  if (host.endsWith(".notify.windows.com")) return t("alerts.devices.edge");
  return t("alerts.devices.browser");
}

function DeviceList({
  allowed,
  transport,
  device,
}: {
  allowed: boolean;
  transport: AlertsTransport;
  device: PushDevice;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const queryClient = useQueryClient();
  const devices = useMyAlertDevices(allowed, transport);
  const [removing, setRemoving] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    fontFamily: nativeFontFamily(typography.bodyMeta),
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  async function remove(item: AlertDevice, isThis: boolean) {
    setFailed(false);
    setRemoving(item.id);
    try {
      if (isThis) {
        await device.disable();
      } else if (item.endpoint) {
        await transport.unregisterWebPush(item.endpoint);
      }
      await queryClient.invalidateQueries({ queryKey: ["alerts", "devices"] });
    } catch {
      setFailed(true);
    } finally {
      setRemoving(null);
    }
  }

  const list = devices.data ?? [];
  return (
    <Card testID="alerts-devices">
      <Text
        accessibilityRole="header"
        style={{
          color: colors.text.primary,
          fontSize: typography.h3.fontSize,
          fontFamily: nativeFontFamily(typography.h3),
          ...READING_START,
          lineHeight: typography.h3.lineHeight,
          fontWeight: typography.h3.fontWeight,
        }}
      >
        {t("alerts.devices.title")}
      </Text>
      {devices.isLoading ? <ActivityIndicator /> : null}
      {devices.isError ? <Text style={meta}>{t("alerts.devices.loadFailed")}</Text> : null}
      {!devices.isLoading && !devices.isError && list.length === 0 ? (
        <Text style={meta} testID="alerts-devices-empty">
          {t("alerts.devices.empty")}
        </Text>
      ) : null}
      {list.map((item) => {
        // A browser by its endpoint; the phone app by the id the server
        // gave it (a phone has no endpoint).
        const isThis =
          (item.endpoint !== null && item.endpoint === device.endpoint) ||
          (device.subscriptionId !== null && item.id === device.subscriptionId);
        const name = deviceKindLabel(item, t);
        return (
          <View
            key={item.id}
            testID={`alerts-device-row-${item.id}`}
            style={[styles.deviceRow, { borderTopColor: colors.border.subtle, paddingTop: spacing[3], gap: spacing[3] }]}
          >
            <View style={{ flex: 1, gap: spacing[1] }}>
              <View style={[styles.row, { gap: spacing[2] }]}>
                <Text style={{ color: colors.text.primary, fontSize: typography.bodyDefault.fontSize, fontFamily: nativeFontFamily(typography.bodyDefault, "600"), ...READING_START, fontWeight: "600" }}>
                  {name}
                </Text>
                {isThis ? (
                  <View style={[styles.chip, { borderColor: colors.status.success, paddingHorizontal: spacing[2] }]}>
                    <Text style={{ color: colors.text.primary, fontSize: typography.labelCaption.fontSize, fontFamily: nativeFontFamily(typography.labelCaption, "700"), ...READING_START, fontWeight: "700" }}>
                      {t("alerts.devices.thisDevice")}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text style={meta}>
                {t("alerts.devices.added", { date: formatDateOnly(item.createdAt, i18n.language, t) })}
              </Text>
              {item.lastOkAt !== null ? (
                <Text style={meta}>
                  {t("alerts.devices.lastDelivered", { date: formatDateOnly(item.lastOkAt, i18n.language, t) })}
                </Text>
              ) : null}
              {item.disabled ? (
                <Text style={[meta, { color: colors.status.warning }]}>
                  {item.kind === "expo" ? t("alerts.devices.stoppedPhone") : t("alerts.devices.stopped")}
                </Text>
              ) : null}
            </View>
            {item.endpoint || isThis ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("alerts.devices.removeA11y", { device: name })}
                accessibilityState={{ disabled: removing !== null }}
                disabled={removing !== null}
                onPress={() => void remove(item, isThis)}
                hitSlop={8}
                style={styles.link}
                testID={`alerts-device-remove-${item.id}`}
              >
                <Text
                  style={{
                    color: colors.text.link,
                    fontSize: typography.labelButton.fontSize,
                    fontFamily: nativeFontFamily(typography.labelButton),
                    ...READING_START,
                    fontWeight: typography.labelButton.fontWeight,
                    opacity: removing === item.id ? 0.5 : 1,
                  }}
                >
                  {t("alerts.devices.remove")}
                </Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
      {failed ? <ErrorText text={t("alerts.devices.removeFailed")} /> : null}
    </Card>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
  primary,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
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
          backgroundColor: primary ? colors.brand.primary : "transparent",
          borderColor: primary ? colors.brand.primary : colors.border.default,
          paddingVertical: spacing[3],
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Text
        style={{
          color: primary ? colors.brand.onPrimary : colors.text.primary,
          fontSize: typography.labelButton.fontSize,
          fontFamily: nativeFontFamily(typography.labelButton, "700"),
          fontWeight: "700",
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
  dot: { width: 12, height: 12, borderRadius: 6 },
  stepRow: { flexDirection: "row", alignItems: "flex-start" },
  stepNumber: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  deviceRow: { flexDirection: "row", alignItems: "flex-start", borderTopWidth: StyleSheet.hairlineWidth },
  link: { minHeight: 44, justifyContent: "center" },
  button: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 52,
    paddingStart: 16,
    paddingEnd: 16,
    alignItems: "center",
    justifyContent: "center",
  },
});
