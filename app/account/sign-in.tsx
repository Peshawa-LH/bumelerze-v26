import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { AccountButton } from "@/features/account/components/AccountButton";
import { CreateAccountForm } from "@/features/account/components/CreateAccountForm";
import { SignInForm } from "@/features/account/components/SignInForm";
import { syncAccountNow, useAccountStore } from "@/features/account/store";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";

type Step = "create" | "signin" | "welcome";

/**
 * Create an account / sign in, with email and password (no emails are sent).
 * Creating upgrades this install's guest user in place, so reports keep their
 * owner; signing in to an existing account moves this device's reports over.
 * `?mode=signin` opens the sign-in form first ("I already have an account").
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

  const title =
    step === "signin" ? t("account.signIn.signInTitle") : t("account.signIn.title");
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
        ) : (
          <>
            <Text
              accessibilityRole="header"
              style={[typography.h2, { color: colors.text.primary }]}
            >
              {title}
            </Text>
            {step === "create" ? (
              <CreateAccountForm onCreated={() => afterAuth(0)} />
            ) : (
              <SignInForm
                onSignedIn={(result) => afterAuth(result.claimed)}
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
