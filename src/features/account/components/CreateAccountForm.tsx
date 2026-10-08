import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import { isAppleAuthEnabled, isGoogleAuthEnabled } from "../constants";
import { accountErrorText } from "../error-text";
import { createAccountWithPassword, startOAuth, type OAuthProvider } from "../service";
import { AccountError } from "../types";
import { validateCreateAccount } from "../validation";
import { AccountButton } from "./AccountButton";
import { AuthErrorText } from "./AuthErrorText";
import { AuthField } from "./AuthField";

/**
 * "Create an account": email, the email again (the address cannot be checked
 * by mail yet, so typing it twice is the typo guard) and a password. The
 * guest user is upgraded in place by `createAccountWithPassword`, so
 * everything made as a guest stays. Google / Apple buttons exist but stay
 * hidden until their env flags are "1".
 */
export function CreateAccountForm({
  onCreated,
}: {
  onCreated: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [email, setEmail] = useState("");
  const [emailAgain, setEmailAgain] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const showGoogle = isGoogleAuthEnabled();
  const showApple = isAppleAuthEnabled();
  const filled = email.trim() !== "" && emailAgain.trim() !== "" && password !== "";

  async function submit() {
    if (busy) {
      return;
    }
    setErrorText(null);
    const problem = validateCreateAccount({ email, emailAgain, password });
    if (problem) {
      setErrorText(accountErrorText(t, new AccountError(problem)));
      return;
    }
    setBusy(true);
    try {
      await createAccountWithPassword(email, password);
      await onCreated();
    } catch (error) {
      setErrorText(accountErrorText(t, error));
    } finally {
      setBusy(false);
    }
  }

  async function oauth(provider: OAuthProvider) {
    setErrorText(null);
    try {
      await startOAuth(provider);
    } catch (error) {
      setErrorText(accountErrorText(t, error));
    }
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
        {t("account.signIn.intro")}
      </Text>
      <AuthField
        kind="email"
        label={t("account.signIn.emailLabel")}
        placeholder={t("account.signIn.emailPlaceholder")}
        value={email}
        onChangeText={setEmail}
        returnKeyType="next"
        testID="account-email-input"
      />
      <AuthField
        kind="email"
        label={t("account.signIn.emailAgainLabel")}
        hint={t("account.signIn.emailNote")}
        value={emailAgain}
        onChangeText={setEmailAgain}
        returnKeyType="next"
        testID="account-email-again-input"
      />
      <AuthField
        kind="newPassword"
        label={t("account.signIn.passwordLabel")}
        hint={t("account.signIn.passwordHint")}
        value={password}
        onChangeText={setPassword}
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
        testID="account-password-input"
      />
      <AccountButton
        tone="primary"
        label={t("account.signIn.createButton")}
        disabled={!filled || busy}
        onPress={() => void submit()}
        testID="account-create-submit"
      />
      <AuthErrorText text={errorText} testID="account-error" />
      {showGoogle || showApple ? (
        <View style={{ gap: spacing[3] }}>
          <Text
            style={{
              color: colors.text.secondary,
              fontSize: typography.bodyDefault.fontSize,
              textAlign: "center",
            }}
          >
            {t("account.signIn.or")}
          </Text>
          {showGoogle ? (
            <AccountButton
              label={t("account.signIn.google")}
              onPress={() => void oauth("google")}
              testID="account-google"
            />
          ) : null}
          {showApple ? (
            <AccountButton
              label={t("account.signIn.apple")}
              onPress={() => void oauth("apple")}
              testID="account-apple"
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
