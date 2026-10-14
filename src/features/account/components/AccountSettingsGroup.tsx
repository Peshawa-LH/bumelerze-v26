import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AuthoritySharingRow } from "@/features/authority/components/AuthoritySharingRow";
import { useTheme } from "@/theme";
import { useAccount } from "../use-account";
import { DeleteAccountRow } from "./DeleteAccountRow";
import { PasswordRow } from "./PasswordRow";
import { PrivacyRow } from "./PrivacyRow";
import { SettingsGroup } from "./SettingsGroup";
import { SignOutRow } from "./SignOutRow";

/**
 * Settings > Account, for a signed-in account only: Password, Privacy & data
 * (with the email), the switch for government officials (0066, default off),
 * Sign out and, last and apart, Delete account. They left
 * the Profile page so that it keeps one tidy "Only you see this" list
 * (review note 5.1, mockup 3a).
 */
export function AccountSettingsGroup() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const account = useAccount();
  if (account.status !== "account") {
    return null;
  }
  return (
    <View style={{ gap: spacing[3] }} testID="settings-group-account">
      <Text
        accessibilityRole="header"
        style={[typography.labelButton, { color: colors.text.secondary }]}
      >
        {t("settings.accountSectionTitle")}
      </Text>
      <SettingsGroup>
        <PasswordRow />
        <PrivacyRow email={account.email} />
        <AuthoritySharingRow />
        <SignOutRow />
      </SettingsGroup>
      <DeleteAccountRow />
    </View>
  );
}
