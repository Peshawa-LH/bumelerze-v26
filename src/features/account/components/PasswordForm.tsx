import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme, nativeFontFamily, READING_START } from "@/theme";
import { accountErrorText } from "../error-text";
import { changeAccountPassword, setAccountPassword } from "../service";
import { isCompleteTwoStepCode, verifyTwoStepCode } from "../two-step";
import { validateNewPassword } from "../validation";
import { AccountError } from "../types";
import { AccountButton } from "./AccountButton";
import { AuthErrorText } from "./AuthErrorText";
import { AuthField } from "./AuthField";
import { CodeField } from "./CodeField";

/**
 * Set or change the password of the signed-in account. An account that has
 * a password (`hasPassword`) changes it: the current one is asked first and
 * checked by signing in again with it (security checklist A0.1). Accounts
 * made by email link have none yet and simply choose one. With two-step
 * sign-in on, the change also needs a 6-digit code: the form asks for it
 * and then saves.
 */
export function PasswordForm({
  onDone,
  hasPassword,
}: {
  onDone: () => void;
  hasPassword: boolean;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [passwordAgain, setPasswordAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);

  const bodyStyle = {
    color: colors.text.secondary,
    fontSize: typography.bodyDefault.fontSize,
    fontFamily: nativeFontFamily(typography.bodyDefault),
    ...READING_START,
    lineHeight: typography.bodyDefault.lineHeight,
  };

  function finishSaved() {
    setCurrent("");
    setPassword("");
    setPasswordAgain("");
    setCode("");
    setNeedsCode(false);
    setSaved(true);
  }

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
      if (hasPassword) {
        await changeAccountPassword(current, password);
      } else {
        await setAccountPassword(password);
      }
      finishSaved();
    } catch (error) {
      if (error instanceof AccountError && error.code === "code_needed") {
        setNeedsCode(true);
      } else {
        setErrorText(accountErrorText(t, error));
      }
    } finally {
      setBusy(false);
    }
  }

  // Two-step sign-in is on: the code raises this session, then the change
  // (the current password, if asked, was already checked).
  async function submitCode() {
    if (!isCompleteTwoStepCode(code) || busy) {
      return;
    }
    setBusy(true);
    setErrorText(null);
    try {
      await verifyTwoStepCode(code);
      await setAccountPassword(password);
      finishSaved();
    } catch (error) {
      setErrorText(accountErrorText(t, error));
      if (error instanceof AccountError && error.code === "wrong_code") {
        setCode("");
      }
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

  if (needsCode) {
    return (
      <View style={{ gap: spacing[3] }} testID="password-code-step">
        <Text style={bodyStyle}>{t("account.twoStep.challenge.body")}</Text>
        <CodeField
          label={t("account.twoStep.codeLabel")}
          value={code}
          onChangeText={setCode}
          onSubmitEditing={() => void submitCode()}
          testID="password-code-input"
        />
        <AccountButton
          tone="primary"
          label={t("account.twoStep.challenge.verify")}
          disabled={!isCompleteTwoStepCode(code) || busy}
          onPress={() => void submitCode()}
          testID="password-code-verify"
        />
        <AuthErrorText text={errorText} testID="password-error" />
      </View>
    );
  }

  return (
    <View style={{ gap: spacing[3] }}>
      <Text style={bodyStyle} testID="password-intro">
        {hasPassword ? t("account.password.introChange") : t("account.password.intro")}
      </Text>
      {hasPassword ? (
        <AuthField
          kind="currentPassword"
          label={t("account.password.currentLabel")}
          value={current}
          onChangeText={setCurrent}
          returnKeyType="next"
          testID="password-current-input"
        />
      ) : null}
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
        disabled={
          password === "" || passwordAgain === "" || (hasPassword && current === "") || busy
        }
        onPress={() => void submit()}
        testID="password-save"
      />
      <AuthErrorText text={errorText} testID="password-error" />
    </View>
  );
}
