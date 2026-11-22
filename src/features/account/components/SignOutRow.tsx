import { Text } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import { signOutAccount } from "../service";
import { useAccountAction } from "../use-account-action";
import { useRefreshTwoStep } from "../use-two-step";
import { SettingsRow, SettingsRowBody } from "./SettingsRow";

/** "Sign out": one tap, no confirmation (the device simply gets a fresh
 * anonymous identity). Last row of the settings group; signed-in only.
 * Afterwards the permissions are re-read, so admin tools go at once and a
 * later sign-in to the same account never sees the old answer. */
export function SignOutRow() {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const { busy, errorText, run } = useAccountAction();
  const refreshTwoStep = useRefreshTwoStep();
  return (
    <>
      <SettingsRow
        icon="log-out-outline"
        label={t("myData.account.signOut")}
        trailing="none"
        disabled={busy}
        onPress={() =>
          void run(async () => {
            await signOutAccount();
            refreshTwoStep();
          })
        }
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
