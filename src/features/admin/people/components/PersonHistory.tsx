import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useSnackbar } from "@/components/Snackbar";
import { communityErrorText } from "@/features/community/error-text";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import type { EventHubTransport } from "@/features/eventhub/transport";
import { restoreErrorText } from "@/features/undo/error-text";
import { useTheme } from "@/theme";
import { useAdminAccess, useAdminActions, useAdminActivity } from "../../queries";
import type { AdminTransport } from "../../transport";
import { UNDOABLE_ACTIONS, type ActivityEntry, type UndoableAction } from "../../types";
import { ActivityRow } from "../../components/ActivityRow";

/** Every audit row about this person (what admins did to them, and who looked
 * at their record), newest first, with Undo where the action can be undone.
 * Reads `admin_activity` filtered by the person; moderators see content
 * actions only, the official rank everything. */
export function PersonHistory({
  userId,
  transport,
  hubTransport,
}: {
  userId: string;
  transport?: AdminTransport;
  hubTransport?: EventHubTransport;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const access = useAdminAccess(hubTransport);
  const actions = useAdminActions(transport, hubTransport);
  const snackbar = useSnackbar();
  const activity = useAdminActivity(
    { action: null, targetUserId: userId },
    access.canAudit,
    transport,
  );
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const [undoError, setUndoError] = useState<{ id: string; text: string } | null>(null);
  const rows: ActivityEntry[] = (activity.data?.pages ?? []).flat();
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  if (!access.canAudit) {
    return null;
  }

  function canUndo(entry: ActivityEntry): boolean {
    if (entry.revertedBy !== null) {
      return false;
    }
    const needed = UNDOABLE_ACTIONS[entry.action as UndoableAction];
    return needed !== undefined && access.has(needed);
  }

  async function undo(entry: ActivityEntry) {
    setUndoingId(entry.id);
    setUndoError(null);
    try {
      await actions.undoAction(entry.id);
      snackbar.show({ message: t("snackbar.restored") });
    } catch (error) {
      setUndoError({ id: entry.id, text: restoreErrorText(t, error) });
    } finally {
      setUndoingId(null);
    }
  }

  return (
    <View style={{ gap: spacing[2] }} testID="person-history">
      <Text accessibilityRole="header" style={[typography.h3, { color: colors.text.primary }]}>
        {t("admin.person.history.title")}
      </Text>
      {activity.isLoading ? (
        <Text style={meta}>{t("eventDetail.loading")}</Text>
      ) : activity.isError ? (
        <Text accessibilityRole="alert" style={[meta, { color: colors.status.danger }]}>
          {communityErrorText(t, activity.error)}
        </Text>
      ) : rows.length === 0 ? (
        <Text style={meta} testID="person-history-empty">
          {t("admin.person.history.empty")}
        </Text>
      ) : (
        rows.map((entry) => (
          <ActivityRow
            key={entry.id}
            entry={entry}
            renderAction={(row) =>
              canUndo(row) ? (
                <View style={styles.undoRow}>
                  <ActionButton
                    label={t("admin.activity.undo")}
                    disabled={undoingId === row.id}
                    onPress={() => void undo(row)}
                    testID={`activity-undo-${row.id}`}
                  />
                  {undoError?.id === row.id ? (
                    <Text
                      accessibilityRole="alert"
                      style={[meta, { color: colors.status.danger }]}
                      testID={`activity-undo-error-${row.id}`}
                    >
                      {undoError.text}
                    </Text>
                  ) : null}
                </View>
              ) : null
            }
          />
        ))
      )}
      {activity.hasNextPage ? (
        <ActionButton
          label={
            activity.isFetchingNextPage ? t("eventDetail.loading") : t("admin.activity.loadMore")
          }
          disabled={activity.isFetchingNextPage}
          onPress={() => void activity.fetchNextPage()}
          testID="person-history-more"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  undoRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
});
