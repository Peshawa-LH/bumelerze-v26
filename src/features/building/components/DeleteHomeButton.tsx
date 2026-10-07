import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { AccountButton } from "@/features/account/components/AccountButton";
import { confirmDialog, messageDialog } from "@/lib/dialogs";
import { useTheme } from "@/theme";
import { homeErrorText } from "../error-text";
import { useHomeActions } from "../queries";
import { ErrorText } from "./ui";

/**
 * "Delete this home", for the owner only. A quiet outlined button at the foot
 * of a screen; the system confirm says what goes (answers, report, photos and
 * family links, for everyone) and that it cannot be undone. On success the
 * home queries are refreshed (the My home card falls back to "Tag my
 * building") and the owner lands on My account. Members never see this; they
 * keep "Leave this home".
 */
export function DeleteHomeButton({ tagId }: { tagId: string }) {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const router = useRouter();
  const actions = useHomeActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const result = await actions.deleteHome(tagId);
      router.replace("/my-data");
      if (result.photosLeftBehind) {
        messageDialog(t("building.delete.doneTitle"), t("building.delete.photosLeft"));
      }
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
