import { Stack, useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { AccountButton } from "@/features/account/components/AccountButton";
import { TwoStepCodeForm } from "@/features/account/components/TwoStepCodeForm";
import { claimThisDevicesReports, signOutAccount } from "@/features/account/service";
import { useAccount } from "@/features/account/use-account";
import { useRefreshTwoStep } from "@/features/account/use-two-step";
import { KEYBOARD_AWARE_SCROLL } from "@/lib/keyboard-scroll";
import { useTheme, nativeFontFamily, READING_START } from "@/theme";

/**
 * "Enter your code" for a device found signed in to an account with
 * two-step sign-in on but without a code in this session (it signed in
 * before two-step sign-in was turned on, or left the sign-in at the code).
 * Opened by the check at start and on return to the app
 * (`useTwoStepGate`). Back leaves it for now: the check asks again next
 * time, and the app itself keeps working (the feed must never be locked
 * behind a code).
 */
export default function TwoStepCodeScreen() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const account = useAccount();
  const refresh = useRefreshTwoStep();

  function leave() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  }

  const message = {
    color: colors.text.secondary,
    fontSize: typography.bodyDefault.fontSize,
    fontFamily: nativeFontFamily(typography.bodyDefault),
    ...READING_START,
    lineHeight: typography.bodyDefault.lineHeight,
  };

  return (
    <View style={[styles.flex, { backgroundColor: colors.surface.base }]}>
      <Stack.Screen
        options={{
          title: t("account.twoStep.challenge.title"),
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
        {account.status === "account" ? (
          <TwoStepCodeForm
            onVerified={async () => {
              // A sign-in left at the code has not moved this device's
              // reports yet (it never throws).
              await claimThisDevicesReports().catch(() => 0);
              refresh();
              leave();
            }}
            onUseDifferentAccount={async () => {
              await signOutAccount();
              refresh();
              router.replace({ pathname: "/account/sign-in", params: { mode: "signin" } });
            }}
            onContactUs={() => router.push("/feedback")}
          />
        ) : account.status === "loading" ? (
          <Text style={message}>{t("nav.loading")}</Text>
        ) : (
          <View style={{ gap: spacing[3] }}>
            <Text style={message}>{t("account.errors.no_session")}</Text>
            <AccountButton
              tone="primary"
              label={t("account.signIn.signInTitle")}
              onPress={() =>
                router.replace({ pathname: "/account/sign-in", params: { mode: "signin" } })
              }
              testID="two-step-code-go-sign-in"
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
