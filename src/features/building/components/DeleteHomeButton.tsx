import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { AccountButton } from "@/features/account/components/AccountButton";
import { useUndoToast } from "@/features/undo/use-undo-toast";
import { confirmDialog } from "@/lib/dialogs";
import { useTheme } from "@/theme";
import { homeErrorText } from "../error-text";
import { useHomeActions } from "../queries";
import { ErrorText } from "./ui";

/**
 * "Delete this home", for the owner only. A quiet outlined button at the foot
 * of a screen. Since migration 0061 the home goes to the trash for 14 days:
 * the system confirm says so, every member loses access at once, and the
 * owner can restore it from Profile (or with the snackbar's Undo). On success
 * the home queries are refreshed (the My home card falls back to "Tag my
 * building") and the owner lands on My account. Members never see this; they
 * keep "Leave this home".
 */
export function DeleteHomeButton({ tagId }: { tagId: string }) {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const router = useRouter();
  const actions = useHomeActions();
  const showUndo = useUndoToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await actions.trashHome(tagId);
      router.replace("/my-data");
      showUndo({
        message: t("building.trash.snackbar"),
        restore: () => actions.restoreHome(tagId),
      });
    } catch (caught) {
      setError(homeErrorText(t, caught));
    } finally {
      setBusy(false);
    }
  }

  function ask() {
    confirmDialog({
      title: t("building.delete.title"),
      message: t("building.delete.warning"),
      confirmLabel: t("building.delete.confirm"),
      cancelLabel: t("building.family.cancel"),
      destructive: true,
      onConfirm: () => void remove(),
    });
  }

  return (
    <View style={{ gap: spacing[2] }}>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <AccountButton
        tone="destructive"
        label={t("building.delete.action")}
        onPress={ask}
        disabled={busy}
        testID="home-delete"
      />
    </View>
  );
}
