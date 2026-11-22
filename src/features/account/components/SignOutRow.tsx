import { useState } from "react";
import { Text } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import { signOutAccount } from "../service";
import { readyToSignOut } from "../sign-out-check";
import { useAccountAction } from "../use-account-action";
import { useRefreshTwoStep } from "../use-two-step";
import { SettingsRow, SettingsRowBody } from "./SettingsRow";

/** "Sign out". Last row of the settings group; signed-in only.
 *
 * A tap first tries, for a few seconds, to send what still waits on this
 * device (reports, messages, check-ins, home photos) while the person is
 * still signed in. When everything went, it signs out at once, as before;
 * when something did not, it asks first ("Not sent yet": signing out
 * deletes them from this device), and Cancel changes nothing. Signing out
 * clears this person's data from the device (security audit APP-04). The
 * check is `readyToSignOut`, shared with "Use a different account".
 * Afterwards the permissions are re-read, so admin tools go at once and a
 * later sign-in to the same account never sees the old answer. */
export function SignOutRow() {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const { busy, errorText, run } = useAccountAction();
  const refreshTwoStep = useRefreshTwoStep();
  const [sending, setSending] = useState(false);

  async function onPress() {
    if (busy || sending) {
      return;
    }
    setSending(true);
    let goAhead: boolean;
    try {
      goAhead = await readyToSignOut(t);
    } finally {
      setSending(false);
    }
    if (!goAhead) {
      return;
    }
    await run(async () => {
      await signOutAccount({ sendFirst: false });
      refreshTwoStep();
    });
  }

  return (
    <>
      <SettingsRow
        icon="log-out-outline"
        label={t("myData.account.signOut")}
        trailing="none"
        disabled={busy || sending}
        onPress={() => void onPress()}
        testID="account-sign-out"
      />
      {errorText ? (
        <SettingsRowBody>
          <Text
            accessibilityRole="alert"
            style={[typography.bodyDefault, { color: colors.status.danger }]}
          >
            {errorText}
          </Text>
        </SettingsRowBody>
      ) : null}
    </>
  );
}
