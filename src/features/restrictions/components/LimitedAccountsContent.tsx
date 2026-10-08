import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSnackbar } from "@/components/Snackbar";
import { useAdminAccess } from "@/features/admin/queries";
import { communityErrorText } from "@/features/community/error-text";
import { profileHref } from "@/features/community/routes";
import { formatUsername } from "@/features/community/username";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import type { EventHubTransport } from "@/features/eventhub/transport";
import { useTheme } from "@/theme";
import { levelText, reasonText, untilText } from "../labels";
import { useAdminRestrictions, useRestrictionActions } from "../queries";
import type { RestrictionsTransport } from "../transport";
import type { AdminRestriction } from "../types";

/** Admin > Limited accounts: the limits in force first, then those made in the
 * last 30 days, each with who, why, until when and a Lift button (a suspension
 * needs `accounts.suspend`). Gated by `accounts.restrict` inside; a stray link
 * shows nothing. */
export function LimitedAccountsContent({
  transport,
  hubTransport,
}: {
  transport?: RestrictionsTransport;
  hubTransport?: EventHubTransport;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const access = useAdminAccess(hubTransport);
  const canRestrict = access.has("accounts.restrict");
  const canSuspend = access.has("accounts.suspend");
  const list = useAdminRestrictions(canRestrict, transport);
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  if (!canRestrict) {
    return access.isLoading ? null : (
      <View style={{ padding: spacing[4] }}>
        <Text style={meta} testID="limited-no-access">
          {t("community.errors.forbidden")}
        </Text>
      </View>
    );
  }
  const rows = list.data ?? [];
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      testID="admin-limited"
      contentContainerStyle={[
        styles.content,
        {
          gap: spacing[3],
          padding: spacing[4],
          paddingBottom: insets.bottom + spacing[6],
        },
      ]}
    >
      <Text style={meta}>{t("restrictions.list.hint")}</Text>
      {list.isLoading ? (
        <Text style={meta} testID="limited-loading">
          {t("eventDetail.loading")}
        </Text>
      ) : list.isError ? (
        <View style={{ gap: spacing[1] }}>
          <Text
            accessibilityRole="alert"
            style={[meta, { color: colors.status.danger }]}
            testID="limited-error"
          >
            {communityErrorText(t, list.error)}
          </Text>
          <ActionButton
            label={t("events.retry")}
            onPress={() => void list.refetch()}
            testID="limited-retry"
          />
        </View>
      ) : rows.length === 0 ? (
        <Text style={meta} testID="limited-empty">
          {t("restrictions.list.empty")}
        </Text>
      ) : (
        rows.map((row) => (
          <LimitedRow
            key={row.id}
            row={row}
            canSuspend={canSuspend}
            transport={transport}
          />
        ))
      )}
    </ScrollView>
  );
}

function LimitedRow({
  row,
  canSuspend,
  transport,
}: {
  row: AdminRestriction;
  canSuspend: boolean;
  transport?: RestrictionsTransport | undefined;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const actions = useRestrictionActions(transport);
  const snackbar = useSnackbar();
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  const name =
    row.userName ??
    (row.userUsername ? formatUsername(row.userUsername) : null) ??
    t(row.isGuest ? "restrictions.list.guest" : "restrictions.list.account", {
      id: row.userId.slice(0, 8),
    });
  const status = row.active
    ? row.endsAt === null
      ? t("restrictions.list.untilLifted")
      : t("restrictions.list.until", { date: untilText(t, i18n.language, row.endsAt) })
    : row.liftedAt !== null
      ? row.liftedByName
        ? t("restrictions.list.lifted", { name: row.liftedByName })
        : t("restrictions.list.liftedPlain")
      : t("restrictions.list.ended");
  const canLift = row.active && (row.level !== "suspend" || canSuspend);

  async function lift() {
    setBusy(true);
    setErrorText(null);
    try {
      await actions.lift(row.id);
      snackbar.show({ message: t("snackbar.limitLifted") });
    } catch (error) {
      setErrorText(communityErrorText(t, error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View
      testID={`limited-${row.id}`}
      style={[
        styles.item,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[3],
          gap: spacing[1],
        },
      ]}
    >
      <Text
        style={{
          color: colors.text.primary,
          fontSize: typography.bodyDefault.fontSize,
          lineHeight: typography.bodyDefault.lineHeight,
          fontWeight: "600",
        }}
        testID={`limited-name-${row.id}`}
      >
        {name}
      </Text>
      <Text style={meta} testID={`limited-level-${row.id}`}>
        {[levelText(t, row.level), reasonText(t, row.reason)].join(" · ")}
      </Text>
      <Text style={meta} testID={`limited-status-${row.id}`}>
        {status}
      </Text>
      {row.createdByName ? (
        <Text style={meta}>{t("admin.activity.by", { name: row.createdByName })}</Text>
      ) : null}
      {row.note ? (
        <Text style={meta} testID={`limited-note-${row.id}`}>
          {t("restrictions.list.note", { note: row.note })}
        </Text>
      ) : null}
      {row.appealRequestedAt !== null ? (
        <Text style={[meta, { fontWeight: "600" }]} testID={`limited-appeal-${row.id}`}>
          {t("restrictions.list.appeal")}
        </Text>
      ) : null}
      <View style={styles.actions}>
        {row.userUsername ? (
          <ActionButton
            label={t("admin.reports.open")}
            onPress={() => router.push(profileHref(row.userUsername as string))}
            testID={`limited-open-${row.id}`}
          />
        ) : null}
        {canLift ? (
          <ActionButton
            label={t("restrictions.list.lift")}
            disabled={busy}
            onPress={() => void lift()}
            testID={`limited-lift-${row.id}`}
          />
        ) : null}
      </View>
      {errorText ? (
        <Text accessibilityRole="alert" style={[meta, { color: colors.status.danger }]}>
          {errorText}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: 560, alignSelf: "center" },
  item: { borderWidth: 1, borderRadius: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
});
