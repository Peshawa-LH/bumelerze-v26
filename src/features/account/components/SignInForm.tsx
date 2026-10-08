import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import { accountErrorText } from "../error-text";
import { signInWithPassword, type SignInResult } from "../service";
import { isPlausibleEmail } from "../validation";
import { AccountButton } from "./AccountButton";
import { AuthErrorText } from "./AuthErrorText";
import { AuthField } from "./AuthField";

/**
 * "Sign in" with email and password on another device. Reports made on this
 * device are moved into the account (the count comes back in the result).
 * "Forgot your password?" explains that resets by email are not live yet and
 * hands over to the Feedback form; no email is ever sent from here.
 */
export function SignInForm({
  onSignedIn,
  onContactUs,
}: {
  onSignedIn: (result: SignInResult) => void | Promise<void>;
  onContactUs: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);

  const ready = isPlausibleEmail(email) && password !== "";
  const bodyStyle = {
    color: colors.text.secondary,
    fontSize: typography.bodyDefault.fontSize,
    lineHeight: typography.bodyDefault.lineHeight,
  };

  async function submit() {
    if (!ready || busy) {
      return;
    }
    setBusy(true);
    setErrorText(null);
    try {
      const result = await signInWithPassword(email, password);
      await onSignedIn(result);
    } catch (error) {
      setErrorText(accountErrorText(t, error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: spacing[3] }}>
      <Text style={bodyStyle}>{t("account.signIn.signInIntro")}</Text>
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
        kind="currentPassword"
        label={t("account.signIn.passwordLabel")}
        value={password}
        onChangeText={setPassword}
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
        testID="account-password-input"
      />
      <AccountButton
        tone="primary"
        label={t("account.signIn.signInButton")}
        disabled={!ready || busy}
        onPress={() => void submit()}
        testID="account-signin-submit"
      />
      <AuthErrorText text={errorText} testID="account-error" />
      <AccountButton
        label={t("account.signIn.forgot")}
        onPress={() => setForgotOpen((open) => !open)}
        testID="account-forgot"
      />
      {forgotOpen ? (
        <View style={{ gap: spacing[3] }} testID="account-forgot-info">
          <Text style={bodyStyle}>{t("account.signIn.forgotInfo")}</Text>
          <AccountButton
            label={t("account.signIn.forgotContact")}
            onPress={onContactUs}
            testID="account-forgot-contact"
          />
        </View>
      ) : null}
    </View>
  );
}
