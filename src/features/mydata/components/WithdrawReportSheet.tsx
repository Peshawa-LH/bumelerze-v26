import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AccountButton } from "@/features/account/components/AccountButton";
import { Sheet } from "@/features/admin/people/components/Sheet";
import {
  restoreWithdrawnReport,
  withdrawReport,
  type FeltTransport,
} from "@/features/felt";
import { useUndoToast } from "@/features/undo/use-undo-toast";
import { useTheme } from "@/theme";

import type { ContributionRowViewModel } from "../format";

export interface WithdrawReportSheetProps {
  row: ContributionRowViewModel;
  onClose: () => void;
  /** Tests inject a fake; the app uses the default felt transport. */
  transport?: FeltTransport;
}

/**
 * The confirm sheet behind "Withdraw" in My reports (review note 10.1). It
 * says what happens: the report leaves the list and every public map and
 * count; the server keeps it but no longer shows or counts it. After the
 * withdraw the usual "done, Undo" snackbar gives a short way back (the
 * server allows the Undo for 10 minutes).
 */
export function WithdrawReportSheet({
  row,
  onClose,
  transport,
}: WithdrawReportSheetProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const undoToast = useUndoToast();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function confirm() {
    if (busy) {
      return;
    }
    setBusy(true);
    setFailed(false);
    const result = await withdrawReport(row.reportId, transport);
    setBusy(false);
    if (result !== "withdrawn") {
      setFailed(true);
      return;
    }
    onClose();
    undoToast({
      message: t("snackbar.reportWithdrawn"),
      restore: () => restoreWithdrawnReport(row.reportId, transport),
    });
  }

  const body = {
    color: colors.text.secondary,
    fontSize: typography.bodyDefault.fontSize,
    lineHeight: typography.bodyDefault.lineHeight,
  } as const;

  return (
    <Sheet
      title={t("myData.withdraw.title")}
      subtitle={row.dateText}
      onClose={onClose}
      testID="withdraw-sheet"
    >
      <View style={{ gap: spacing[3] }}>
        <Text style={body} testID="withdraw-sheet-body">
          {t("myData.withdraw.body")}
        </Text>
        <Text style={body}>{t("myData.withdraw.undoNote")}</Text>
        {failed ? (
          <Text
            accessibilityRole="alert"
            testID="withdraw-sheet-error"
            style={[body, { color: colors.status.danger }]}
          >
            {t("myData.withdraw.failed")}
          </Text>
        ) : null}
        <AccountButton
          tone="destructiveSolid"
          label={t("myData.withdraw.confirm")}
          disabled={busy}
          onPress={() => void confirm()}
          testID="withdraw-sheet-confirm"
        />
        <AccountButton
          label={t("myData.withdraw.cancel")}
          onPress={onClose}
          testID="withdraw-sheet-cancel"
        />
      </View>
    </Sheet>
  );
}
