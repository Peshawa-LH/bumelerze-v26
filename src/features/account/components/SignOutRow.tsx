import { Text } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import { signOutAccount } from "../service";
import { useAccountAction } from "../use-account-action";
import { SettingsRow, SettingsRowBody } from "./SettingsRow";

/** "Sign out": one tap, no confirmation (the device simply gets a fresh
 * anonymous identity). Last row of the settings group; signed-in only. */
export function SignOutRow() {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const { busy, errorText, run } = useAccountAction();
  return (
    <>
      <SettingsRow
        icon="log-out-outline"
        label={t("myData.account.signOut")}
        trailing="none"
        disabled={busy}
        onPress={() => void run(signOutAccount)}
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
