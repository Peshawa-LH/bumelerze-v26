import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import { accountErrorText } from "../error-text";
import { setAccountPassword } from "../service";
import { validateNewPassword } from "../validation";
import { AccountError } from "../types";
import { AccountButton } from "./AccountButton";
import { AuthErrorText } from "./AuthErrorText";
import { AuthField } from "./AuthField";

/** Set or change the password of the signed-in account (the same screen does
 * both: accounts made by email link start without one). */
export function PasswordForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [password, setPassword] = useState("");
  const [passwordAgain, setPasswordAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  async function submit() {
    if (busy) {
      return;
    }
    setErrorText(null);
    const problem = validateNewPassword({ password, passwordAgain });
    if (problem) {
      setErrorText(accountErrorText(t, new AccountError(problem)));
      return;
    }
    setBusy(true);
    try {
      await setAccountPassword(password);
      setPassword("");
      setPasswordAgain("");
      setSaved(true);
    } catch (error) {
      setErrorText(accountErrorText(t, error));
    } finally {
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <View style={{ gap: spacing[3] }}>
        <Text
          accessibilityLiveRegion="polite"
          testID="password-saved"
          style={[typography.bodyDefault, { color: colors.status.success }]}
        >
          {t("account.password.saved")}
        </Text>
        <AccountButton
          tone="primary"
          label={t("account.password.done")}
          onPress={onDone}
          testID="password-done"
        />
      </View>
    );
  }

  return (
    <View style={{ gap: spacing[3] }}>
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyDefault.fontSize,
          lineHeight: typography.bodyDefault.lineHeight,
        }}
      >
        {t("account.password.intro")}
      </Text>
      <AuthField
        kind="newPassword"
        label={t("account.password.newLabel")}
        hint={t("account.signIn.passwordHint")}
        value={password}
        onChangeText={setPassword}
        returnKeyType="next"
        testID="password-new-input"
      />
      <AuthField
        kind="newPassword"
        label={t("account.password.confirmLabel")}
        value={passwordAgain}
        onChangeText={setPasswordAgain}
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
        testID="password-confirm-input"
      />
      <AccountButton
        tone="primary"
        label={t("account.password.save")}
        disabled={password === "" || passwordAgain === "" || busy}
        onPress={() => void submit()}
        testID="password-save"
      />
      <AuthErrorText text={errorText} testID="password-error" />
    </View>
  );
}
