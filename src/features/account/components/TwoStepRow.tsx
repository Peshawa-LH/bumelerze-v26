import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { SettingsRow } from "./SettingsRow";

/** "Two-step sign-in: On / Off": opens its own screen. The group shows it
 * only when `useTwoStepOffer().offered` (accounts with admin tools, or with
 * two-step sign-in already on); everyone else sees nothing. */
export function TwoStepRow({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <SettingsRow
      icon="lock-closed-outline"
      label={t("account.twoStep.row")}
      value={enabled ? t("account.twoStep.on") : t("account.twoStep.off")}
      onPress={() => router.push("/account/two-step")}
      testID="account-two-step-row"
    />
  );
}
