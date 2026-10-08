import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useAdminAccess } from "@/features/admin/queries";
import { FollowRequestsSection } from "@/features/community/components/FollowRequestsSection";
import { useFollowRequests } from "@/features/community/queries";
import { localizeDigits } from "@/lib/format-numbers";
import { useAccount } from "../use-account";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsRow } from "./SettingsRow";

/**
 * The community part of the owner's Profile page, for signed-in accounts
 * only: follow requests to answer right here, then the "People and requests"
 * row (requests and blocked accounts) and, for holders of an admin
 * permission, the admin tools. The row for "my public profile" is gone (D79):
 * the page itself is the public profile. Every row is hidden when its
 * feature is not available.
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
  const pending = requests.data?.length ?? 0;

  return (
    <>
      <FollowRequestsSection />
      <SettingsGroup testID="account-community-group">
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
