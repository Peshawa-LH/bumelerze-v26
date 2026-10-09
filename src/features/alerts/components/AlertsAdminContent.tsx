import { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAdminAccess } from "@/features/admin/queries";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import type { EventHubTransport } from "@/features/eventhub/transport";
import { confirmDialog } from "@/lib/dialogs";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";

import { useAlertsAdminActions, useAlertsOverview } from "../queries";
import { SupabaseAlertsTransport, toAlertsError, type AlertsTransport } from "../transport";
import { ALERT_MODES, type AlertMode, type AlertsOverview } from "../types";

/**
 * Admin > Alerts (migration 0062). Seen with `alerts.test` (official and the
 * private admin rank); changing who receives alerts and the tester list needs
 * `alerts.manage` (the same two ranks), which the server checks again. The
 * rollout is changed only here, by one deliberate tap and a confirmation.
 */
export function AlertsAdminContent({
  transport = SupabaseAlertsTransport,
  hubTransport,
}: {
  transport?: AlertsTransport;
  hubTransport?: EventHubTransport;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const access = useAdminAccess(hubTransport);
  const allowed = access.has("alerts.test");
  const overview = useAlertsOverview(allowed, transport);
  const actions = useAlertsAdminActions(transport);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [testText, setTestText] = useState<string | null>(null);
  const locale = i18n.language;
  const num = (value: number) => localizeDigits(String(value), locale);
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;
  const body = {
    color: colors.text.primary,
    fontSize: typography.bodyDefault.fontSize,
    lineHeight: typography.bodyDefault.lineHeight,
  } as const;

  if (!allowed) {
    return (
      <View style={{ padding: spacing[4] }}>
        {access.isLoading ? null : (
          <Text style={meta} testID="alerts-admin-no-access">
            {t("community.errors.forbidden")}
          </Text>
        )}
      </View>
    );
  }

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setErrorText(null);
    try {
      await action();
      return true;
    } catch (error) {
      const code = toAlertsError(error).code;
      setErrorText(code === "not_found" ? t("admin.alerts.notFound") : t("alerts.device.failed"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function chooseMode(mode: AlertMode) {
    if (mode === "public" || mode === "off") {
      const key = mode === "public" ? "Public" : "Off";
      confirmDialog({
        title: t(`admin.alerts.confirm${key}Title`),
        message: t(`admin.alerts.confirm${key}Message`),
        confirmLabel: t(`admin.alerts.confirm${key}`),
        cancelLabel: t("admin.alerts.cancel"),
        onConfirm: () => void run(() => actions.setMode(mode)),
      });
      return;
    }
    void run(() => actions.setMode(mode));
  }

  async function sendTest() {
    setTestText(null);
    try {
      await transport.sendTest();
      setTestText(t("alerts.test.sent"));
    } catch (error) {
      const code = toAlertsError(error).code;
      setTestText(
        code === "too_soon"
          ? t("alerts.test.tooSoon")
          : code === "no_device"
            ? t("alerts.test.noDevice")
            : t("alerts.device.failed"),
      );
    }
  }

  const data: AlertsOverview | undefined = overview.data;
  const canManage = data?.canManage ?? false;

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.content,
        { gap: spacing[5], padding: spacing[4], paddingBottom: insets.bottom + spacing[6] },
      ]}
      testID="alerts-admin"
    >
      <Text style={meta}>{t("admin.alerts.hint")}</Text>
      {overview.isLoading ? <Text style={meta}>{t("eventDetail.loading")}</Text> : null}
      {overview.isError ? <Text style={meta}>{t("alerts.device.failed")}</Text> : null}

      {data ? (
        <>
          <Card testID="alerts-admin-mode">
            <Text accessibilityRole="header" style={[typography.h3, { color: colors.text.primary }]}>
              {t("admin.alerts.modeTitle")}
            </Text>
            <Text style={[body, { fontWeight: "700" }]} testID="alerts-admin-mode-now">
              {t(`admin.alerts.modes.${data.mode}`)}
            </Text>
            {canManage ? (
              <View style={styles.row}>
                {ALERT_MODES.map((mode) => (
                  <ActionButton
                    key={mode}
                    label={t(`admin.alerts.modes.${mode}`)}
                    selected={data.mode === mode}
                    disabled={busy || data.mode === mode}
                    onPress={() => chooseMode(mode)}
                    testID={`alerts-admin-mode-${mode}`}
                  />
                ))}
              </View>
            ) : null}
            <Text style={meta}>
              {t("admin.alerts.stats", { devices: num(data.devices), waiting: num(data.waiting) })}
            </Text>
          </Card>

          <Card testID="alerts-admin-test">
            <Text accessibilityRole="header" style={[typography.h3, { color: colors.text.primary }]}>
              {t("admin.alerts.testTitle")}
            </Text>
            <Text style={meta}>{t("admin.alerts.testHint")}</Text>
            <View style={styles.row}>
              <ActionButton
                label={t("alerts.test.button")}
                onPress={() => void sendTest()}
                testID="alerts-admin-send-test"
              />
            </View>
            {testText ? (
              <Text style={meta} accessibilityLiveRegion="polite" testID="alerts-admin-test-result">
                {testText}
              </Text>
            ) : null}
          </Card>

          <Card testID="alerts-admin-testers">
            <Text accessibilityRole="header" style={[typography.h3, { color: colors.text.primary }]}>
              {t("admin.alerts.testersTitle")}
            </Text>
            {data.testers.length === 0 ? <Text style={meta}>{t("admin.alerts.testersEmpty")}</Text> : null}
            {data.testers.map((tester) => (
              <View key={tester.userId} style={[styles.spaceBetween, { gap: spacing[2] }]} testID={`alerts-admin-tester-${tester.userId}`}>
                <View style={styles.flex}>
                  <Text style={body}>
                    {tester.displayName ?? tester.username ?? tester.userId.slice(0, 8)}
                    {tester.username ? ` @${tester.username}` : ""}
                  </Text>
                  <Text style={meta}>
                    {tester.via === "rank" ? `${t("admin.alerts.byRank")} · ` : ""}
                    {t("admin.alerts.devicesCount", { number: num(tester.devices) })}
                  </Text>
                </View>
                {canManage && tester.via === "allowlist" ? (
                  <ActionButton
                    label={t("admin.alerts.remove")}
                    danger
                    disabled={busy}
                    onPress={() => void run(() => actions.removeTester(tester.userId))}
                    testID={`alerts-admin-remove-${tester.userId}`}
                  />
                ) : null}
              </View>
            ))}
            {canManage ? <AddTester busy={busy} onAdd={(name) => run(() => actions.addTester(name))} /> : null}
          </Card>

          <Card testID="alerts-admin-runs">
            <Text accessibilityRole="header" style={[typography.h3, { color: colors.text.primary }]}>
              {t("admin.alerts.runsTitle")}
            </Text>
            {data.runs.length === 0 ? <Text style={meta}>{t("admin.alerts.runsEmpty")}</Text> : null}
            {data.runs.map((r) => (
              <View key={r.runId} testID="alerts-admin-run">
                <Text style={[meta, { color: colors.text.primary }]}>
                  {Number.isFinite(r.startedAt)
                    ? new Date(r.startedAt).toLocaleString(locale, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : ""}
                </Text>
                <Text style={meta}>
                  {t("admin.alerts.run", {
                    planned: num(r.planned),
                    sent: num(r.sent),
                    failed: num(r.failed + r.gone),
                    suppressed: num(r.suppressed),
                  })}
                </Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {errorText ? (
        <Text accessibilityRole="alert" style={{ color: colors.status.danger, fontSize: typography.bodyMeta.fontSize }}>
          {errorText}
        </Text>
      ) : null}
    </ScrollView>
  );
}

function AddTester({ busy, onAdd }: { busy: boolean; onAdd: (username: string) => Promise<boolean> }) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [value, setValue] = useState("");
  const name = value.trim().replace(/^@/, "");
  return (
    <View style={{ gap: spacing[2] }}>
      <TextInput
        value={value}
        onChangeText={setValue}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={t("admin.alerts.addPlaceholder")}
        placeholderTextColor={colors.text.tertiary}
        accessibilityLabel={t("admin.alerts.addLabel")}
        testID="alerts-admin-add-input"
        style={[
          styles.input,
          {
            color: colors.text.primary,
            borderColor: colors.border.default,
            backgroundColor: colors.surface.base,
            fontSize: typography.bodyDefault.fontSize,
            paddingHorizontal: spacing[3],
          },
        ]}
      />
      <View style={styles.row}>
        <ActionButton
          label={t("admin.alerts.add")}
          disabled={busy || name === ""}
          onPress={() =>
            void onAdd(name).then((added) => {
              if (added) {
                setValue("");
              }
            })
          }
          testID="alerts-admin-add"
        />
      </View>
    </View>
  );
}

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
          padding: spacing[3],
          gap: spacing[2],
        },
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: 560, alignSelf: "center" },
  card: { borderWidth: 1, borderRadius: 12 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  spaceBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  flex: { flex: 1 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12 },
});
