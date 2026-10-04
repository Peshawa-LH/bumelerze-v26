import { Stack, useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { AccountButton } from "@/features/account/components/AccountButton";
import { ProfileForm } from "@/features/account/components/ProfileForm";
import { useAccount } from "@/features/account/use-account";
import { useTheme } from "@/theme";

/** Create / edit the account profile. Needs a signed-in account. */
export default function ProfileScreen() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const account = useAccount();

  const message = {
    color: colors.text.secondary,
    fontSize: typography.bodyDefault.fontSize,
    lineHeight: typography.bodyDefault.lineHeight,
  };

  let body;
  if (account.status === "account") {
    body = account.profileLoaded ? (
      // Keyed so the form re-initializes if the stored rows change under it.
      <ProfileForm
        key={account.userId ?? "account"}
        profile={account.profile}
        privateProfile={account.privateProfile}
      />
    ) : (
      <Text style={message}>{t("account.profile.loading")}</Text>
    );
  } else if (account.status === "loading") {
    body = <Text style={message}>{t("account.profile.loading")}</Text>;
  } else {
    body = (
      <View style={{ gap: spacing[3] }}>
        <Text style={message}>{t("account.profile.needsAccount")}</Text>
        <AccountButton
          tone="primary"
          label={t("account.signIn.title")}
          onPress={() => router.replace("/account/sign-in")}
          testID="profile-go-sign-in"
        />
      </View>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: colors.surface.base }]}>
      <Stack.Screen
        options={{
          title: t("account.profile.title"),
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
          style={{
            color: colors.text.primary,
            fontSize: typography.h2.fontSize,
            lineHeight: typography.h2.lineHeight,
            fontWeight: typography.h2.fontWeight,
          }}
        >
          {t("account.profile.title")}
        </Text>
        {body}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
