import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { SNACKBAR_ADMIN_MS, SNACKBAR_MS, useSnackbar } from "@/components/Snackbar";

export interface UndoToastInput {
  /** Already translated, e.g. "Comment deleted". */
  message: string;
  /** Calls the restore function. The server has already done the delete. */
  restore: () => Promise<void>;
  /** An admin's hide or remove stays up for 10 s instead of 8 s. */
  admin?: boolean;
}

/** "Done. Undo" for a delete, unfollow, hide or remove. */
export function useUndoToast(): (input: UndoToastInput) => void {
  const { t } = useTranslation();
  const { show } = useSnackbar();
  return useCallback(
    ({ message, restore, admin = false }) =>
      show({
        message,
        actionLabel: t("snackbar.undo"),
        onAction: restore,
        durationMs: admin ? SNACKBAR_ADMIN_MS : SNACKBAR_MS,
      }),
    [show, t],
  );
}
