import type { TFunction } from "i18next";

import { confirmDialog } from "@/lib/dialogs";
import { sendWaitingItemsBeforeSignOut } from "./service";

/**
 * The check before every sign-out the person starts (the Sign out row, and
 * "Use a different account" at the 6-digit code): what still waits on this
 * device (reports, messages, check-ins, home photos) is sent first, for a few
 * seconds, while the person is still signed in. Resolves `true` when the
 * sign-out may go ahead: everything went, or the person chose "Sign out
 * anyway" in the "Not sent yet" question. `false` after Cancel, which
 * changes nothing. Never rejects. The caller then signs out with
 * `signOutAccount({ sendFirst: false })` (security audit APP-04).
 */
export async function readyToSignOut(t: TFunction): Promise<boolean> {
  let unsent: number;
  try {
    unsent = await sendWaitingItemsBeforeSignOut();
  } catch {
    // Cannot tell (it never throws by design): ask rather than delete.
    unsent = 1;
  }
  if (unsent === 0) {
    return true;
  }
  return await new Promise<boolean>((resolve) => {
    confirmDialog({
      title: t("myData.account.signOutUnsent.title"),
      message: t("myData.account.signOutUnsent.body"),
      confirmLabel: t("myData.account.signOutUnsent.confirm"),
      cancelLabel: t("myData.account.deleteCancel"),
      destructive: true,
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}
