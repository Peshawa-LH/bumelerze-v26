import { Stack, useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { AccountButton } from "@/features/account/components/AccountButton";
import { PasswordForm } from "@/features/account/components/PasswordForm";
import { accountErrorText } from "@/features/account/error-text";
import { useAccount } from "@/features/account/use-account";
import { useAccountHasPassword } from "@/features/account/use-two-step";
import { KEYBOARD_AWARE_SCROLL } from "@/lib/keyboard-scroll";
import { useTheme } from "@/theme";

/** Set or change the password. Needs a signed-in account; accounts made
 * before passwords existed (by email link) have none and set one here. An
 * account that has one gives it first (`my_account_has_password()`,
 * migration 0075; before 0075 is on the server, the old form). */
export default function PasswordScreen() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const account = useAccount();
  const hasPassword = useAccountHasPassword(
    account.status === "account" ? account.userId : null,
  );

  return (
    <View style={[styles.flex, { backgroundColor: colors.surface.base }]}>
      <Stack.Screen
        options={{
          title: t("account.password.title"),
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
        {account.status === "account" && hasPassword.isError ? (
          <View style={{ gap: spacing[3] }}>
            <Text style={[typography.bodyDefault, { color: colors.status.danger }]}>
              {accountErrorText(t, hasPassword.error)}
            </Text>
            <AccountButton
              tone="primary"
              label={t("nav.retry")}
              onPress={() => void hasPassword.refetch()}
              testID="password-retry"
            />
          </View>
        ) : account.status === "account" && hasPassword.isSuccess ? (
          <PasswordForm
            hasPassword={hasPassword.data === true}
            onDone={() => router.back()}
          />
        ) : account.status === "loading" || account.status === "account" ? (
          <Text style={[typography.bodyDefault, { color: colors.text.secondary }]}>
            {t("account.profile.loading")}
          </Text>
        ) : (
          <View style={{ gap: spacing[3] }}>
            <Text style={[typography.bodyDefault, { color: colors.text.secondary }]}>
              {t("account.password.needsAccount")}
            </Text>
            <AccountButton
              tone="primary"
              label={t("account.signIn.title")}
              onPress={() => router.replace("/account/sign-in")}
              testID="password-go-sign-in"
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
