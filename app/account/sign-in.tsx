import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { AccountButton } from "@/features/account/components/AccountButton";
import { CreateAccountForm } from "@/features/account/components/CreateAccountForm";
import { SignInForm } from "@/features/account/components/SignInForm";
import { TwoStepCodeForm } from "@/features/account/components/TwoStepCodeForm";
import { claimThisDevicesReports, signOutAccount } from "@/features/account/service";
import { syncAccountNow, useAccountStore } from "@/features/account/store";
import { KEYBOARD_AWARE_SCROLL } from "@/lib/keyboard-scroll";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme, nativeFontFamily, READING_START } from "@/theme";

type Step = "create" | "signin" | "code" | "welcome";

/**
 * Create an account / sign in, with email and password (no emails are sent).
 * Creating upgrades this install's guest user in place, so reports keep their
 * owner; signing in to an existing account moves this device's reports over.
 * `?mode=signin` opens the sign-in form first ("I already have an account").
 * An account with two-step sign-in on asks for the 6-digit code after the
 * password ("code"); this device's reports move into it only after the code.
 */
export default function SignInScreen() {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string }>();

  const [step, setStep] = useState<Step>(params?.mode === "signin" ? "signin" : "create");
  const [claimed, setClaimed] = useState(0);

  /** Reads the fresh session, then sends a new account to the profile form
   * and everyone else back where they came from. */
  async function afterAuth(movedItems: number) {
    await syncAccountNow();
    const { profile, profileLoaded } = useAccountStore.getState();
    if (profileLoaded && !profile) {
      router.replace("/account/profile");
    } else if (movedItems > 0) {
      setClaimed(movedItems);
      setStep("welcome");
    } else {
      router.back();
    }
  }

  /** After the code: move this device's reports, then as after a password. */
  async function afterCode() {
    const moved = await claimThisDevicesReports().catch(() => 0);
    await afterAuth(moved);
  }

  const title =
    step === "code"
      ? t("account.twoStep.challenge.title")
      : step === "signin"
        ? t("account.signIn.signInTitle")
        : t("account.signIn.title");
  const switchLabel =
    step === "signin" ? t("account.signIn.newHere") : t("account.signIn.haveAccount");

  return (
    <View style={[styles.flex, { backgroundColor: colors.surface.base }]}>
      <Stack.Screen
        options={{
          title,
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <ScrollView
        {...KEYBOARD_AWARE_SCROLL}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          gap: spacing[4],
          padding: spacing[5],
          paddingBottom: insets.bottom + spacing[6],
        }}
      >
        {step === "welcome" ? (
          <>
            <Text
              accessibilityRole="header"
              accessibilityLiveRegion="polite"
              style={[typography.h2, { color: colors.text.primary }]}
            >
              {t("account.signIn.welcomeBack")}
            </Text>
            <Text
              style={{
                color: colors.text.secondary,
                fontSize: typography.bodyDefault.fontSize,
                fontFamily: nativeFontFamily(typography.bodyDefault),
                ...READING_START,
                lineHeight: typography.bodyDefault.lineHeight,
              }}
            >
              {t("account.signIn.claimed", {
                count: localizeDigits(String(claimed), i18n.language),
              })}
            </Text>
            <AccountButton
              tone="primary"
              label={t("account.signIn.done")}
              onPress={() => router.back()}
              testID="account-done"
            />
          </>
        ) : step === "code" ? (
          <TwoStepCodeForm
            onVerified={afterCode}
            onUseDifferentAccount={async () => {
              await signOutAccount();
              setStep("signin");
            }}
            onContactUs={() => router.push("/feedback")}
          />
        ) : (
          <>
            {/* The title is the stack header's (review B-27: it was repeated
             * here as a page heading, like on every other pushed screen it
             * is shown once, in the header). */}
            {step === "create" ? (
              <CreateAccountForm onCreated={() => afterAuth(0)} />
            ) : (
              <SignInForm
                onSignedIn={(result) =>
                  result.needsCode ? setStep("code") : afterAuth(result.claimed)
                }
                onContactUs={() =>
                  router.push({ pathname: "/feedback", params: { passwordReset: "1" } })
                }
              />
            )}
            <AccountButton
              label={switchLabel}
              onPress={() => setStep(step === "signin" ? "create" : "signin")}
              testID="account-switch-mode"
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
