import { Stack, useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { AccountButton } from "@/features/account/components/AccountButton";
import { PasswordForm } from "@/features/account/components/PasswordForm";
import { useAccount } from "@/features/account/use-account";
import { useTheme } from "@/theme";

/** Set or change the password. Needs a signed-in account; accounts made
 * before passwords existed (by email link) have none and set one here. */
export default function PasswordScreen() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const account = useAccount();

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
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          gap: spacing[4],
          padding: spacing[5],
          paddingBottom: insets.bottom + spacing[6],
        }}
      >
        <Text
          accessibilityRole="header"
          style={[typography.h2, { color: colors.text.primary }]}
        >
          {t("account.password.title")}
        </Text>
        {account.status === "account" ? (
          <PasswordForm onDone={() => router.back()} />
        ) : account.status === "loading" ? (
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
