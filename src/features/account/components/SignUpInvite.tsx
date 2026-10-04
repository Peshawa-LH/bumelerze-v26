import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import { AccountButton } from "./AccountButton";

const INVITE_ICONS = ["person-circle-outline", "ribbon-outline", "home-outline"] as const;

/** The ONE sign-up invitation on the page, right under the header (anonymous
 * installs only): three decorative icons, one line, "Create an account", and
 * a quiet "I already have an account". */
export function SignUpInvite() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();
  const goToSignIn = () => router.push("/account/sign-in");

  return (
    <View
      testID="sign-up-invite"
      style={[
        styles.card,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[4],
          gap: spacing[3],
        },
      ]}
    >
      <View style={[styles.icons, { gap: spacing[4] }]}>
        {INVITE_ICONS.map((name) => (
          <Ionicons
            key={name}
            name={name}
            size={28}
            color={colors.text.secondary}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        ))}
      </View>
      <Text style={[typography.bodyDefault, styles.line, { color: colors.text.primary }]}>
        {t("myData.invite.line")}
      </Text>
      <AccountButton
        tone="primary"
        label={t("myData.account.create")}
        onPress={goToSignIn}
        testID="account-create"
      />
      <Pressable
        testID="account-have"
        accessibilityRole="button"
        accessibilityLabel={t("myData.account.haveAccount")}
        onPress={goToSignIn}
        style={styles.link}
      >
        <Text style={[typography.labelButton, { color: colors.text.link }]}>
          {t("myData.account.haveAccount")}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14 },
  icons: { flexDirection: "row", justifyContent: "center" },
  line: { textAlign: "center" },
  link: { minHeight: 44, alignItems: "center", justifyContent: "center" },
});
