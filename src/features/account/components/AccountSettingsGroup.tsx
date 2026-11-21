import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import { useAccount } from "../use-account";
import { useTwoStepOffer } from "../use-two-step";
import { DeleteAccountRow } from "./DeleteAccountRow";
import { PasswordRow } from "./PasswordRow";
import { PrivacyRow } from "./PrivacyRow";
import { SettingsGroup } from "./SettingsGroup";
import { SignOutRow } from "./SignOutRow";
import { TwoStepRow } from "./TwoStepRow";

/**
 * Settings > Account, for a signed-in account only: Password, Two-step
 * sign-in (accounts with admin tools only, security checklist A0.1), Privacy
 * & data (with the email), Sign out and, last and apart, Delete account. (The 0066
 * switch for government officials is gone: they always see it, D98.) They left
 * the Profile page so that it keeps one tidy "Only you see this" list
 * (review note 5.1, mockup 3a).
 */
export function AccountSettingsGroup() {
  const account = useAccount();
  if (account.status !== "account") {
    return null;
  }
  return <AccountSettingsGroupBody email={account.email} />;
}

/** Only for a signed-in account, so guests never ask whether to offer
 * two-step sign-in. */
function AccountSettingsGroupBody({ email }: { email: string | null }) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const twoStep = useTwoStepOffer();
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
        {twoStep.offered ? <TwoStepRow enabled={twoStep.enabled} /> : null}
        <PrivacyRow email={email} />
        <SignOutRow />
      </SettingsGroup>
      <DeleteAccountRow />
    </View>
  );
}
