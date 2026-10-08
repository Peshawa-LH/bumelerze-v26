import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useSnackbar } from "@/components/Snackbar";
import { AccountButton } from "@/features/account/components/AccountButton";
import { communityErrorText } from "@/features/community/error-text";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import { useUndoToast } from "@/features/undo/use-undo-toast";
import { useTheme } from "@/theme";
import { useAdminActions } from "../../queries";
import type { AdminTransport } from "../../transport";
import { usePeopleActions } from "../queries";
import type { PeopleTransport } from "../transport";
import type { ResettableField } from "../types";
import { Sheet } from "./Sheet";

/** "Reset name / photo" for an impersonation: the display name goes back to a
 * placeholder and/or the photo is removed from the profile. The server keeps a
 * snapshot, so a snackbar Undo (10 s) and the History row can bring it back. */
export function ResetFieldsSheet({
  userId,
  name,
  canReset,
  onClose,
  peopleTransport,
  transport,
}: {
  userId: string;
  name: string;
  /** Which fields currently hold something worth resetting. */
  canReset: { display_name: boolean; avatar: boolean };
  onClose: () => void;
  peopleTransport?: PeopleTransport;
  transport?: AdminTransport;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const people = usePeopleActions(peopleTransport);
  const admin = useAdminActions(transport);
  const showUndo = useUndoToast();
  const snackbar = useSnackbar();
  const [fields, setFields] = useState<Record<ResettableField, boolean>>({
    display_name: canReset.display_name,
    avatar: canReset.avatar,
  });
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const chosen = (Object.keys(fields) as ResettableField[]).filter((f) => fields[f]);

  async function submit() {
    setBusy(true);
    setErrorText(null);
    try {
      const logId = await people.resetProfile(userId, chosen);
      if (logId === null) {
        snackbar.show({ message: t("snackbar.nothingToReset") });
      } else {
        showUndo({
          message: t("snackbar.profileReset"),
          restore: () => admin.undoAction(logId),
          admin: true,
        });
      }
      onClose();
    } catch (error) {
      setErrorText(communityErrorText(t, error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={t("admin.person.reset.title")}
      subtitle={name}
      onClose={onClose}
      testID="reset-sheet"
    >
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyMeta.fontSize,
          lineHeight: typography.bodyMeta.lineHeight,
        }}
      >
        {t("admin.person.reset.hint")}
      </Text>
      <View style={[styles.chips, { gap: spacing[1] }]}>
        <ActionButton
          label={t("admin.person.reset.name")}
          selected={fields.display_name}
          disabled={!canReset.display_name}
          onPress={() => setFields((f) => ({ ...f, display_name: !f.display_name }))}
          testID="reset-field-name"
        />
        <ActionButton
          label={t("admin.person.reset.photo")}
          selected={fields.avatar}
          disabled={!canReset.avatar}
          onPress={() => setFields((f) => ({ ...f, avatar: !f.avatar }))}
          testID="reset-field-photo"
        />
      </View>
      {errorText ? (
        <Text
          accessibilityRole="alert"
          style={{ color: colors.status.danger, fontSize: typography.bodyMeta.fontSize }}
          testID="reset-error"
        >
          {errorText}
        </Text>
      ) : null}
      <AccountButton
        tone="destructive"
        label={t("admin.person.reset.submit")}
        disabled={busy || chosen.length === 0}
        onPress={() => void submit()}
        testID="reset-submit"
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
});
