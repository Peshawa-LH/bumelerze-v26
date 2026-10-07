import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AccountButton } from "@/features/account/components/AccountButton";
import { useAccount } from "@/features/account/use-account";
import { useTheme } from "@/theme";
import { communityErrorText } from "../error-text";
import type { CommunityActions } from "../queries";
import type { PublicProfile } from "../types";

/**
 * Follow / Requested / Following. Following a private account sends a
 * request ("Request" until it is accepted). An install without an account is
 * taken to sign-in instead: only real accounts can follow.
 */
export function FollowButton({
  profile,
  actions,
}: {
  profile: PublicProfile;
  actions: CommunityActions;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const account = useAccount();
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const status = profile.followStatus;
  const label =
    status === "accepted"
      ? t("community.follow.following")
      : status === "pending"
        ? t("community.follow.requested")
        : profile.isPrivate
          ? t("community.follow.request")
          : t("community.follow.follow");

  async function handlePress() {
    if (account.status !== "account") {
      router.push("/account/sign-in");
      return;
    }
    setBusy(true);
    setErrorText(null);
    try {
      if (status === "none") {
        await actions.follow(profile.userId);
      } else {
        await actions.unfollow(profile.userId);
      }
    } catch (error) {
      setErrorText(communityErrorText(t, error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: spacing[2] }}>
      <AccountButton
        tone={status === "none" ? "primary" : "secondary"}
        label={label}
        disabled={busy}
        onPress={() => void handlePress()}
        accessibilityLabel={t("community.follow.a11y", {
          action: label,
          name: profile.displayName,
        })}
        testID="follow-button"
      />
      {errorText ? (
        <Text
          accessibilityRole="alert"
          style={{
            color: colors.status.danger,
            fontSize: typography.bodyMeta.fontSize,
            lineHeight: typography.bodyMeta.lineHeight,
          }}
        >
          {errorText}
        </Text>
      ) : null}
    </View>
  );
}
