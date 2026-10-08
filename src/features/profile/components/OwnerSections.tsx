import { View } from "react-native";

import { CommunityRows } from "@/features/account/components/CommunityRows";
import { DeleteAccountRow } from "@/features/account/components/DeleteAccountRow";
import { PasswordRow } from "@/features/account/components/PasswordRow";
import { PrivacyRow } from "@/features/account/components/PrivacyRow";
import { SettingsGroup } from "@/features/account/components/SettingsGroup";
import { SignOutRow } from "@/features/account/components/SignOutRow";
import { useAccount } from "@/features/account/use-account";
import { MyHomeCard, TrashedHomesSection } from "@/features/building";
import { DownloadMyDataRow } from "@/features/data-export";
import { MyReportsSection } from "@/features/mydata";
import { useTheme } from "@/theme";
import { OnlyYouDivider } from "./OnlyYouDivider";
import { RecentlyDeletedSection } from "./RecentlyDeletedSection";

/**
 * Everything on the Profile page that only its owner may see, after the
 * "Only you see this" divider: My home, My felt reports, People and requests,
 * the Admin row (when the account has admin access), Recently deleted (my
 * comments and posts of the last 24 hours, when there are any), Deleted homes
 * (the 14-day trash, when there are any), Download my data, Password,
 * Privacy, Sign out and, last, Delete account.
 *
 * PRIVACY RULE (D79): this component and everything under it read the
 * viewer's own data (the felt queue, `my_stats`, homes, follow requests, admin
 * permissions). It is therefore rendered ONLY by the owner's page
 * (`OwnProfile`) and never by the public profile of anyone else: a visitor's
 * render does not mount it, so none of those queries even start. The test
 * `ProfilePrivacy.test.tsx` pins both halves.
 */
export function OwnerSections() {
  const { spacing } = useTheme();
  const account = useAccount();
  const isAccount = account.status === "account";
  return (
    <View style={{ gap: spacing[4] }} testID="owner-sections">
      <OnlyYouDivider />
      <MyHomeCard />
      <MyReportsSection />
      <CommunityRows />
      <RecentlyDeletedSection />
      {isAccount ? <TrashedHomesSection /> : null}
      {isAccount ? <DownloadMyDataRow /> : null}
      <SettingsGroup>
        {isAccount ? <PasswordRow /> : null}
        <PrivacyRow email={account.email} />
        {isAccount ? <SignOutRow /> : null}
      </SettingsGroup>
      {isAccount ? <DeleteAccountRow /> : null}
    </View>
  );
}
