import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StyleSheet, Text, View, Pressable } from "react-native";
import { useTranslation } from "react-i18next";

import { RoleMark } from "@/features/eventhub/components/RoleMark";
import type { HubRole } from "@/features/eventhub/types";
import { formatMonthYear } from "@/features/mydata/format";
import { useTheme } from "@/theme";
import { getAvatarUrl } from "../service";
import { useAccount } from "../use-account";
import { AccountButton } from "./AccountButton";
import { Avatar } from "./Avatar";

/**
 * Identity first: avatar, name (and role mark), "Member since", edit. It sits
 * on the page background, not in a card. An install without an account is a
 * grey person named "Guest", with no edit control.
 */
export function ProfileHeader({
  memberSince,
  roles,
}: {
  memberSince: number | null;
  roles: readonly HubRole[];
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();
  const account = useAccount();
  const isAccount = account.status === "account";
  const name = isAccount
    ? (account.profile?.displayName ?? t("myData.account.noName"))
    : t("myData.guest");

  return (
    <View style={{ gap: spacing[3] }}>
      <View style={[styles.row, { gap: spacing[4] }]}>
        <Avatar
          uri={isAccount ? getAvatarUrl(account.profile?.avatarPath) : null}
          name={isAccount ? (account.profile?.displayName ?? null) : null}
          size={72}
          placeholder="person"
        />
        <View style={styles.text}>
          <View style={[styles.nameRow, { gap: spacing[2] }]}>
            <Text
              accessibilityRole="header"
              numberOfLines={2}
              testID="profile-name"
              style={[typography.h2, styles.name, { color: colors.text.primary }]}
            >
              {name}
            </Text>
            {isAccount ? <RoleMark roles={roles} size={20} /> : null}
          </View>
          {isAccount && memberSince !== null ? (
            <Text
              testID="profile-member-since"
              style={[typography.bodyMeta, { color: colors.text.secondary }]}
            >
              {t("myData.memberSince", {
                date: formatMonthYear(memberSince, i18n.language, t),
              })}
            </Text>
          ) : null}
        </View>
        {isAccount && !(account.profileLoaded && !account.profile) ? (
          <Pressable
            testID="account-edit-profile"
            accessibilityRole="button"
            accessibilityLabel={t("myData.account.editProfile")}
            hitSlop={4}
            onPress={() => router.push("/account/profile")}
            style={({ pressed }) => [
              styles.edit,
              {
                backgroundColor: pressed ? colors.surface.sunken : "transparent",
                borderColor: colors.border.default,
              },
            ]}
          >
            <Ionicons name="create-outline" size={22} color={colors.text.primary} />
          </Pressable>
        ) : null}
      </View>
      {isAccount && account.profileLoaded && !account.profile ? (
        <AccountButton
          tone="primary"
          label={t("myData.account.finishProfile")}
          onPress={() => router.push("/account/profile")}
          testID="account-finish-profile"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  text: { flex: 1, gap: 2 },
  nameRow: { flexDirection: "row", alignItems: "center" },
  name: { flexShrink: 1 },
  edit: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
