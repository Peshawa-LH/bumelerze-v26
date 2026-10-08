import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ActionButton } from "@/features/eventhub/components/ActionButton";
import type { RestrictionsTransport } from "../transport";
import { LimitAccountSheet, type LimitTarget } from "./LimitAccountSheet";

/** "Limit account": the admin's entry on a reported profile, a reported post
 * and an Event hub comment. The caller decides whether to show it (the
 * permission, and never for an admin's own account); the sheet does the rest. */
export function LimitAccountButton({
  target,
  canSuspend,
  transport,
  testID,
}: {
  target: LimitTarget;
  canSuspend: boolean;
  transport?: RestrictionsTransport;
  testID?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <ActionButton
        label={t("restrictions.admin.action")}
        danger
        onPress={() => setOpen(true)}
        {...(testID ? { testID } : {})}
      />
      {open ? (
        <LimitAccountSheet
          target={target}
          canSuspend={canSuspend}
          onClose={() => setOpen(false)}
          {...(transport ? { transport } : {})}
        />
      ) : null}
    </>
  );
}
