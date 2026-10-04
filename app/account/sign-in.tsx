import { Stack, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import {
  EMAIL_CODE_LENGTH,
  RESEND_COOLDOWN_SECONDS,
  isAppleAuthEnabled,
  isGoogleAuthEnabled,
} from "@/features/account/constants";
import { accountErrorText } from "@/features/account/error-text";
import { AccountButton } from "@/features/account/components/AccountButton";
import {
  isPlausibleEmail,
  requestEmailCode,
  startOAuth,
  verifyEmailCode,
  type OAuthProvider,
} from "@/features/account/service";
import { syncAccountNow, useAccountStore } from "@/features/account/store";
import type { EmailAuthMode } from "@/features/account/types";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";

type Step = "email" | "code" | "welcome";

/**
 * Email-code sign-in. For an anonymous install this upgrades the same user
 * (reports keep their owner); for an address that already has an account it
 * signs into it and moves this device's reports over. Google / Apple
 * buttons exist but stay hidden until their env flags are "1".
 */
export default function SignInScreen() {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<EmailAuthMode>("upgrade");
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [claimed, setClaimed] = useState(0);
  const [showCodeEntry, setShowCodeEntry] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const deadlineRef = useRef(0);

  const cooling = secondsLeft > 0;
  useEffect(() => {
    if (!cooling) {
      return;
    }
    const interval = setInterval(() => {
      setSecondsLeft(Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(interval);
  }, [cooling]);

  function startCooldown() {
    deadlineRef.current = Date.now() + RESEND_COOLDOWN_SECONDS * 1000;
    setSecondsLeft(RESEND_COOLDOWN_SECONDS);
  }

  async function sendCode() {
    setBusy(true);
    setErrorText(null);
    try {
      const result = await requestEmailCode(email);
      setMode(result.mode);
      setCode("");
      setShowCodeEntry(false);
      setStep("code");
      startCooldown();
    } catch (error) {
      setErrorText(accountErrorText(t, error));
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode() {
    setBusy(true);
    setErrorText(null);
    try {
      const result = await verifyEmailCode(email, code, mode);
      await syncAccountNow();
      const { profile, profileLoaded } = useAccountStore.getState();
      if (profileLoaded && !profile) {
        router.replace("/account/profile");
      } else if (result.claimed > 0) {
        setClaimed(result.claimed);
        setStep("welcome");
      } else {
        router.back();
      }
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

  const emailOk = isPlausibleEmail(email);
  const codeOk = code.length === EMAIL_CODE_LENGTH;
  const showGoogle = isGoogleAuthEnabled();
  const showApple = isAppleAuthEnabled();

  const inputStyle = [
    styles.input,
    {
      color: colors.text.primary,
      borderColor: colors.border.default,
      backgroundColor: colors.surface.raised,
      fontSize: typography.bodyDefault.fontSize,
      paddingHorizontal: spacing[3],
    },
  ];
  const bodyStyle = {
    color: colors.text.secondary,
    fontSize: typography.bodyDefault.fontSize,
    lineHeight: typography.bodyDefault.lineHeight,
  };

  return (
    <View style={[styles.flex, { backgroundColor: colors.surface.base }]}>
      <Stack.Screen
        options={{
          title: t("account.signIn.title"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          gap: spacing[3],
          padding: spacing[5],
          paddingBottom: insets.bottom + spacing[6],
        }}
      >
        {step === "email" ? (
          <>
            <Text accessibilityRole="header" style={headingStyle(colors.text.primary, typography.h2)}>
              {t("account.signIn.title")}
            </Text>
            <Text style={bodyStyle}>{t("account.signIn.intro")}</Text>
            <Text style={labelStyle(colors.text.primary, typography.bodyDefault.fontSize)}>
              {t("account.signIn.emailLabel")}
            </Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder={t("account.signIn.emailPlaceholder")}
              placeholderTextColor={colors.text.tertiary}
              accessibilityLabel={t("account.signIn.emailLabel")}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              style={inputStyle}
              testID="account-email-input"
            />
            <AccountButton
              tone="primary"
              label={t("account.signIn.sendCode")}
              disabled={!emailOk || busy}
              onPress={() => void sendCode()}
              testID="account-send-code"
            />
            {showGoogle || showApple ? (
              <View style={{ gap: spacing[3] }}>
                <Text style={[bodyStyle, { textAlign: "center" }]}>{t("account.signIn.or")}</Text>
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
          </>
        ) : null}

        {step === "code" ? (
          <>
            <Text accessibilityRole="header" style={headingStyle(colors.text.primary, typography.h2)}>
              {t("account.signIn.checkEmailTitle")}
            </Text>
            <Text style={bodyStyle}>{t("account.signIn.sentTo", { email: email.trim() })}</Text>
            <Text
              style={{
                color: colors.text.primary,
                fontSize: typography.bodyDefault.fontSize,
                lineHeight: typography.bodyDefault.lineHeight,
                fontWeight: "600",
              }}
              testID="account-check-email"
            >
              {t("account.signIn.checkEmail")}
            </Text>

            {showCodeEntry ? (
              <>
                <TextInput
                  value={code}
                  onChangeText={(value) =>
                    setCode(value.replace(/\D/g, "").slice(0, EMAIL_CODE_LENGTH))
                  }
                  accessibilityLabel={t("account.signIn.codeLabel")}
                  placeholder={t("account.signIn.codeLabel")}
                  placeholderTextColor={colors.text.tertiary}
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  maxLength={EMAIL_CODE_LENGTH}
                  autoFocus
                  style={[inputStyle, styles.codeInput, { fontSize: typography.h2.fontSize }]}
                  testID="account-code-input"
                />
                <AccountButton
                  tone="primary"
                  label={t("account.signIn.confirm")}
                  disabled={!codeOk || busy}
                  onPress={() => void confirmCode()}
                  testID="account-confirm-code"
                />
              </>
            ) : (
              <AccountButton
                label={t("account.signIn.haveCode")}
                onPress={() => setShowCodeEntry(true)}
                testID="account-have-code"
              />
            )}
            <AccountButton
              label={
                cooling
                  ? t("account.signIn.resendIn", {
                      seconds: localizeDigits(String(secondsLeft), i18n.language),
                    })
                  : t("account.signIn.resend")
              }
              disabled={cooling || busy}
              onPress={() => void sendCode()}
              testID="account-resend"
            />
            <AccountButton
              label={t("account.signIn.changeEmail")}
              disabled={busy}
              onPress={() => {
                setStep("email");
                setCode("");
                setErrorText(null);
              }}
              testID="account-change-email"
            />
          </>
        ) : null}

        {step === "welcome" ? (
          <>
            <Text
              accessibilityRole="header"
              accessibilityLiveRegion="polite"
              style={headingStyle(colors.text.primary, typography.h2)}
            >
              {t("account.signIn.welcomeBack")}
            </Text>
            <Text style={bodyStyle}>
              {t("account.signIn.claimed", { count: localizeDigits(String(claimed), i18n.language) })}
            </Text>
            <AccountButton
              tone="primary"
              label={t("account.signIn.done")}
              onPress={() => router.back()}
              testID="account-done"
            />
          </>
        ) : null}

        {errorText ? (
          <Text
            accessibilityRole="alert"
            style={{
              color: colors.status.danger,
              fontSize: typography.bodyDefault.fontSize,
              lineHeight: typography.bodyDefault.lineHeight,
            }}
          >
            {errorText}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

function headingStyle(color: string, token: { fontSize: number; lineHeight: number; fontWeight: "400" | "500" | "600" | "700" | "800" }) {
  return {
    color,
    fontSize: token.fontSize,
    lineHeight: token.lineHeight,
    fontWeight: token.fontWeight,
  };
}

function labelStyle(color: string, fontSize: number) {
  return { color, fontSize, fontWeight: "600" as const };
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 52,
    // Email addresses and digits are left-to-right runs in every locale.
    textAlign: "left",
    writingDirection: "ltr",
  },
  codeInput: {
    textAlign: "center",
    letterSpacing: 8,
    fontWeight: "700",
  },
});
