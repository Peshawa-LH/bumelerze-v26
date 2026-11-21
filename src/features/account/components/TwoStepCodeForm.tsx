import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme, nativeFontFamily, READING_START } from "@/theme";
import { accountErrorText } from "../error-text";
import { isCompleteTwoStepCode, verifyTwoStepCode } from "../two-step";
import { AccountError } from "../types";
import { AccountButton } from "./AccountButton";
import { AuthErrorText } from "./AuthErrorText";
import { CodeField } from "./CodeField";
import { LostPhoneNote } from "./LostPhoneNote";

/**
 * "Enter your code": the second step of signing in to an account with
 * two-step sign-in on. The same form serves right after the password (the
 * sign-in screen) and a device found signed in without a code (the
 * /account/two-step-code screen). "Use a different account" signs out.
 */
export function TwoStepCodeForm({
  onVerified,
  onUseDifferentAccount,
  onContactUs,
}: {
  onVerified: () => void | Promise<void>;
  onUseDifferentAccount: () => void | Promise<void>;
  onContactUs: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const ready = isCompleteTwoStepCode(code);

  async function submit() {
    if (!ready || busy) {
      return;
    }
    setBusy(true);
    setErrorText(null);
    try {
      await verifyTwoStepCode(code);
      await onVerified();
    } catch (error) {
      setErrorText(accountErrorText(t, error));
      if (error instanceof AccountError && error.code === "wrong_code") {
        setCode("");
      }
    } finally {
      setBusy(false);
    }
  }

  async function switchAccount() {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await onUseDifferentAccount();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: spacing[3] }} testID="two-step-code-form">
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyDefault.fontSize,
          fontFamily: nativeFontFamily(typography.bodyDefault),
          ...READING_START,
          lineHeight: typography.bodyDefault.lineHeight,
        }}
      >
        {t("account.twoStep.challenge.body")}
      </Text>
      <CodeField
        label={t("account.twoStep.codeLabel")}
        value={code}
        onChangeText={setCode}
        onSubmitEditing={() => void submit()}
        testID="two-step-code-input"
      />
      <AccountButton
        tone="primary"
        label={t("account.twoStep.challenge.verify")}
        disabled={!ready || busy}
        onPress={() => void submit()}
        testID="two-step-verify"
      />
      <AuthErrorText text={errorText} testID="two-step-code-error" />
      <AccountButton
        label={t("account.twoStep.challenge.otherAccount")}
        disabled={busy}
        onPress={() => void switchAccount()}
        testID="two-step-other-account"
      />
      <LostPhoneNote onContactUs={onContactUs} />
    </View>
  );
}
