import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { SettingsRow } from "./SettingsRow";

/** "Password": opens the set / change password screen. Signed-in only. */
export function PasswordRow() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <SettingsRow
      icon="key-outline"
      label={t("myData.account.password")}
      onPress={() => router.push("/account/password")}
      testID="account-password-row"
    />
  );
}
