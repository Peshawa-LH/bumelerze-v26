import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { accountErrorText } from "./error-text";

/** Runs one account action (sign out, delete) with a busy flag and a
 * translated error message instead of a thrown error. */
export function useAccountAction(): {
  busy: boolean;
  errorText: string | null;
  /** Resolves true when the action finished without error. */
  run: (action: () => Promise<void>) => Promise<boolean>;
} {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const run = useCallback(
    async (action: () => Promise<void>) => {
      setBusy(true);
      setErrorText(null);
      try {
        await action();
        return true;
      } catch (error) {
        setErrorText(accountErrorText(t, error));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  return { busy, errorText, run };
}
