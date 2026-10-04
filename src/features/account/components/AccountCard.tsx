import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { IdentityHeader } from "@/features/mydata/components/IdentityHeader";
import { useTheme } from "@/theme";
import { accountErrorText } from "../error-text";
import { deleteAccount, getAvatarUrl, signOutAccount } from "../service";
import { useAccount } from "../use-account";
import { AccountButton } from "./AccountButton";
import { Avatar } from "./Avatar";

/**
 * Top of "My account". Anonymous installs keep the contributor ID card and
 * get a prominent "Create an account" call; signed-in accounts see their
 * photo, name and email with Edit profile / Sign out / Delete account.
 * Renders only the plain ID card while no Supabase project is configured.
 */
export function AccountCard() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();
  const account = useAccount();

  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  if (account.status !== "account") {
    return (
      <View style={{ gap: spacing[3] }}>
        <IdentityHeader />
        {account.status === "anonymous" ? (
          <View
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
            <Text
              style={{
                color: colors.text.secondary,
                fontSize: typography.bodyMeta.fontSize,
                lineHeight: typography.bodyMeta.lineHeight,
              }}
            >
              {t("myData.account.createWhy")}
            </Text>
            <AccountButton
              tone="primary"
              label={t("myData.account.create")}
              onPress={() => router.push("/account/sign-in")}
              testID="account-create"
            />
            <AccountButton
              label={t("myData.account.haveAccount")}
              onPress={() => router.push("/account/sign-in")}
              testID="account-have"
            />
          </View>
        ) : null}
      </View>
    );
  }

  const name = account.profile?.displayName ?? null;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setErrorText(null);
    try {
      await action();
      setConfirmingDelete(false);
    } catch (error) {
      setErrorText(accountErrorText(t, error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View
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
      <View style={[styles.identityRow, { gap: spacing[3] }]}>
        <Avatar uri={getAvatarUrl(account.profile?.avatarPath)} name={name} size={64} />
        <View style={styles.identityText}>
          <Text
            accessibilityRole="header"
            style={{
              color: colors.text.primary,
              fontSize: typography.h3.fontSize,
              lineHeight: typography.h3.lineHeight,
              fontWeight: typography.h3.fontWeight,
            }}
          >
            {name ?? t("myData.account.noName")}
          </Text>
          {account.email ? (
            <Text
              style={{
                color: colors.text.secondary,
                fontSize: typography.bodyMeta.fontSize,
                lineHeight: typography.bodyMeta.lineHeight,
                textAlign: "auto",
              }}
            >
              {account.email}
            </Text>
          ) : null}
        </View>
      </View>

      {account.profileLoaded && !account.profile ? (
        <AccountButton
          tone="primary"
          label={t("myData.account.finishProfile")}
          onPress={() => router.push("/account/profile")}
          testID="account-finish-profile"
        />
      ) : (
        <AccountButton
          label={t("myData.account.editProfile")}
          onPress={() => router.push("/account/profile")}
          testID="account-edit-profile"
        />
      )}

      <AccountButton
        label={t("myData.account.signOut")}
        disabled={busy}
        onPress={() => void run(signOutAccount)}
        testID="account-sign-out"
      />
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyMeta.fontSize,
          lineHeight: typography.bodyMeta.lineHeight,
        }}
      >
        {t("myData.account.signOutNote")}
      </Text>

      {confirmingDelete ? (
        <View
          style={[styles.confirmBox, { borderColor: colors.status.danger, padding: spacing[3], gap: spacing[3] }]}
        >
          <Text
            accessibilityRole="alert"
            style={{
              color: colors.text.primary,
              fontSize: typography.bodyDefault.fontSize,
              lineHeight: typography.bodyDefault.lineHeight,
            }}
          >
            {t("myData.account.deleteWarning")}
          </Text>
          <AccountButton
            tone="destructiveSolid"
            label={t("myData.account.deleteConfirm")}
            disabled={busy}
            onPress={() => void run(deleteAccount)}
            testID="account-delete-confirm"
          />
          <AccountButton
            label={t("myData.account.deleteCancel")}
            disabled={busy}
            onPress={() => setConfirmingDelete(false)}
            testID="account-delete-cancel"
          />
        </View>
      ) : (
        <AccountButton
          tone="destructive"
          label={t("myData.account.delete")}
          disabled={busy}
          onPress={() => setConfirmingDelete(true)}
          testID="account-delete"
        />
      )}

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
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 14,
  },
  identityRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  identityText: {
    flex: 1,
    gap: 2,
  },
  confirmBox: {
    borderWidth: 1,
    borderRadius: 12,
  },
});
