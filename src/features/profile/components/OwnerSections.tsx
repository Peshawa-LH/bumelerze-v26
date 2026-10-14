import { View } from "react-native";

import { useTheme } from "@/theme";
import { OnlyYouDivider } from "./OnlyYouDivider";
import { OwnerList } from "./OwnerList";
import { RecentlyDeletedSection } from "./RecentlyDeletedSection";

/**
 * Everything on the Profile page that only its owner may see, after the
 * "Only you see this" divider (review note 5.1, mockup 3a): one tidy list
 * (My reports, My home, People and requests, Download my data, Admin tools
 * for admins) and, only when there is something in it, Recently deleted (my
 * comments and posts of the last 24 hours). My home has its own page (with
 * the 14-day trash of deleted homes); Password, Privacy, Sign out and Delete
 * account are in Settings > Account.
 *
 * PRIVACY RULE (D79): this component and everything under it read the
 * viewer's own data (the felt queue, homes, follow requests, admin
 * permissions). It is therefore rendered ONLY by the owner's page
 * (`OwnProfile`) and never by the public profile of anyone else: a visitor's
 * render does not mount it, so none of those queries even start. The test
 * `ProfilePrivacy.test.tsx` pins both halves.
 */
export function OwnerSections() {
  const { spacing } = useTheme();
  return (
    <View style={{ gap: spacing[3] }} testID="owner-sections">
      <OnlyYouDivider />
      <OwnerList />
      <RecentlyDeletedSection />
    </View>
  );
}
