import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useAdminAccess } from "@/features/admin/queries";
import { FollowRequestsSection } from "@/features/community/components/FollowRequestsSection";
import { useFollowRequests } from "@/features/community/queries";
import { profileHref } from "@/features/community/routes";
import { localizeDigits } from "@/lib/format-numbers";
import { useAccount } from "../use-account";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsRow } from "./SettingsRow";

/**
 * The community part of My account, for signed-in accounts only: follow
 * requests to answer right here, then rows for the public profile, People
 * (requests and blocked accounts) and, for holders of an admin permission,
 * the admin tools. Every row is hidden when its feature is not available.
 */
export function CommunityRows() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const account = useAccount();
  const requests = useFollowRequests();
  const admin = useAdminAccess();

  if (account.status !== "account") {
    return null;
  }
  const username = account.profile?.username ?? null;
  const pending = requests.data?.length ?? 0;

  return (
    <>
      <FollowRequestsSection />
      <SettingsGroup testID="account-community-group">
        {username ? (
          <SettingsRow
            icon="person-circle-outline"
            label={t("community.myAccount.profile")}
            onPress={() => router.push(profileHref(username))}
            testID="account-public-profile-row"
          />
        ) : null}
        <SettingsRow
          icon="people-outline"
          label={t("community.myAccount.people")}
          value={pending > 0 ? localizeDigits(String(pending), i18n.language) : null}
          onPress={() => router.push("/account/people")}
          testID="account-people-row"
        />
        {admin.any ? (
          <SettingsRow
            icon="shield-checkmark-outline"
            label={t("community.myAccount.admin")}
            onPress={() => router.push("/admin")}
            testID="account-admin-row"
          />
        ) : null}
      </SettingsGroup>
    </>
  );
}
