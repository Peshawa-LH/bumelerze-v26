import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useSnackbar } from "@/components/Snackbar";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import { formatAbsoluteDual } from "@/features/events";
import { confirmDialog } from "@/lib/dialogs";
import { useTheme } from "@/theme";
import { homeErrorText } from "../error-text";
import { useHomeActions, useTrashedHomes } from "../queries";
import type { HomeTransport } from "../transport";
import type { TrashedHome } from "../types";

/**
 * "Deleted homes" (migration 0061, owner-only part of the Profile page): homes
 * in the 14-day trash, each with Restore and "Delete now". Hidden when there
 * are none, while loading, or before the migration. Only the owner's own
 * homes, with label and code (never their coordinates).
 */
export function TrashedHomesSection({ transport }: { transport?: HomeTransport }) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const trashed = useTrashedHomes(transport);
  if (trashed.data.length === 0) {
    return null;
  }
  return (
    <View style={{ gap: spacing[2] }} testID="trashed-homes">
      <Text
        accessibilityRole="header"
        style={[typography.h3, { color: colors.text.primary }]}
      >
        {t("building.trash.title")}
      </Text>
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyMeta.fontSize,
          lineHeight: typography.bodyMeta.lineHeight,
        }}
      >
        {t("building.trash.hint")}
      </Text>
      {trashed.data.map((home) => (
        <TrashedHomeRow
          key={home.tagId}
          home={home}
          {...(transport ? { transport } : {})}
        />
      ))}
    </View>
  );
}

function TrashedHomeRow({
  home,
  transport,
}: {
  home: TrashedHome;
  transport?: HomeTransport;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const snackbar = useSnackbar();
  const actions = useHomeActions(transport);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;
  const name = home.label || home.code;
  const until = formatAbsoluteDual(home.purgeAt, i18n.language, t).local;

  async function run(action: () => Promise<void>, done: string) {
    setBusy(true);
    setErrorText(null);
    try {
      await action();
      snackbar.show({ message: done });
    } catch (error) {
      setErrorText(homeErrorText(t, error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View
      testID={`trashed-home-${home.tagId}`}
      style={[
        styles.card,
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
          textAlign: "auto",
        }}
      >
        {name}
      </Text>
      <Text style={meta}>{t("building.trash.until", { date: until })}</Text>
      <View style={[styles.actions, { gap: spacing[1] }]}>
        <ActionButton
          label={t("building.trash.restore")}
          disabled={busy}
          onPress={() =>
            void run(() => actions.restoreHome(home.tagId), t("building.trash.restored"))
          }
          testID={`restore-home-${home.tagId}`}
        />
        <ActionButton
          label={t("building.trash.deleteNow")}
          danger
          disabled={busy}
          onPress={() =>
            confirmDialog({
              title: t("building.trash.deleteNowTitle"),
              message: t("building.trash.deleteNowWarning"),
              confirmLabel: t("building.delete.confirm"),
              cancelLabel: t("building.family.cancel"),
              destructive: true,
              onConfirm: () =>
                void run(
                  () => actions.deleteHomeNow(home.tagId),
                  t("building.delete.doneTitle"),
                ),
            })
          }
          testID={`delete-home-now-${home.tagId}`}
        />
      </View>
      {errorText ? (
        <Text
          accessibilityRole="alert"
          style={[meta, { color: colors.status.danger }]}
          testID={`trashed-home-error-${home.tagId}`}
        >
          {errorText}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
});
