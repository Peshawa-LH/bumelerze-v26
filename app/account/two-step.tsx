import { Stack, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { AccountButton } from "@/features/account/components/AccountButton";
import { TwoStepSetupContent } from "@/features/account/components/TwoStepSetupContent";
import { useAccount } from "@/features/account/use-account";
import { useRefreshTwoStep, useTwoStepOffer } from "@/features/account/use-two-step";
import { KEYBOARD_AWARE_SCROLL } from "@/lib/keyboard-scroll";
import { useTheme, nativeFontFamily, READING_START } from "@/theme";

/**
 * My account > Two-step sign-in (security checklist A0.1): set it up with
 * an authenticator app, or turn it off. Offered to accounts with admin
 * tools only (and to an account that already has it on); anyone else who
 * opens this address is sent to Settings.
 */
export default function TwoStepScreen() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const account = useAccount();
  const offer = useTwoStepOffer();
  const refresh = useRefreshTwoStep();
  // Decided once: turning it off must not hide the "it is off" message
  // from someone without admin tools.
  const [allowed, setAllowed] = useState<boolean | null>(null);

  const deciding = account.status === "loading" || offer.isLoading;
  if (allowed === null && !deciding && account.status === "account") {
    setAllowed(offer.offered);
  }
  useEffect(() => {
    if (allowed === false) {
      router.replace("/settings");
    }
  }, [allowed, router]);

  function leave() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/settings");
    }
  }

  const message = {
    color: colors.text.secondary,
    fontSize: typography.bodyDefault.fontSize,
    fontFamily: nativeFontFamily(typography.bodyDefault),
    ...READING_START,
    lineHeight: typography.bodyDefault.lineHeight,
  };

  let body;
  if (account.status !== "account" && account.status !== "loading") {
    body = (
      <View style={{ gap: spacing[3] }}>
        <Text style={message}>{t("account.errors.no_session")}</Text>
        <AccountButton
          tone="primary"
          label={t("account.signIn.signInTitle")}
          onPress={() =>
            router.replace({ pathname: "/account/sign-in", params: { mode: "signin" } })
          }
          testID="two-step-go-sign-in"
        />
      </View>
    );
  } else if (allowed === true) {
    body = (
      <TwoStepSetupContent
        onDone={leave}
        onContactUs={() => router.push("/feedback")}
        onChanged={refresh}
      />
    );
  } else {
    body = <Text style={message}>{t("nav.loading")}</Text>;
  }

  return (
    <View style={[styles.flex, { backgroundColor: colors.surface.base }]}>
      <Stack.Screen
        options={{
          title: t("account.twoStep.title"),
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
        {/* The title is the stack header's alone (review B-27). */}
        {body}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
