import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useAccount } from "@/features/account/use-account";
import { useCommunityActions, usePublicProfile } from "@/features/community/queries";
import { useTheme } from "@/theme";
import { GuestProfile } from "./GuestProfile";
import { OwnProfile } from "./OwnProfile";

/**
 * What the Profile tab shows. A signed-in account gets its own page (public
 * part first, then the owner-only sections); everyone else, including an
 * install with no server, gets the Guest page.
 */
export function ProfileTab() {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const account = useAccount();
  if (account.status === "account") {
    return <AccountProfile />;
  }
  if (account.status === "loading") {
    return (
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyDefault.fontSize,
          lineHeight: typography.bodyDefault.lineHeight,
        }}
      >
        {t("eventDetail.loading")}
      </Text>
    );
  }
  return <GuestProfile />;
}

/** The signed-in page: fetches the account's own public profile (the same
 * `public_profile()` visitors get) and falls back to the device's own data
 * while it loads or when it cannot be read. */
function AccountProfile() {
  const account = useAccount();
  const profile = usePublicProfile(account.profile?.username ?? undefined);
  const actions = useCommunityActions();
  const own = profile.data?.isSelf ? profile.data : null;
  return (
    <View testID="profile-tab-account">
      <OwnProfile profile={own} actions={actions} />
    </View>
  );
}
