import { View } from "react-native";

import { ProfileHeader } from "@/features/account/components/ProfileHeader";
import { useMySummary } from "@/features/account/use-my-summary";
import { EarnedBadges } from "@/features/badges";
import { ProfileCounts } from "@/features/community/components/ProfileCounts";
import { PublicProfileView } from "@/features/community/components/PublicProfileView";
import type { CommunityActions } from "@/features/community/queries";
import type { PublicProfile } from "@/features/community/types";
import { useTheme } from "@/theme";
import { OwnerSections } from "./OwnerSections";

interface OwnProfileProps {
  /** The server's public profile of the signed-in account, or null while it
   * loads or cannot be read (offline, migration missing, no @username yet):
   * the header is then built from what is on the device. */
  profile: PublicProfile | null;
  actions: CommunityActions;
  /** The page sits in a stack screen (`/u/<me>`), not the Profile tab. */
  inStack?: boolean;
}

/**
 * The owner's Profile page (review note 5.1, mockups 3a and 3b): the public
 * part (what visitors see, with Edit / Share profile in place of Follow),
 * the "Only you see this" list, then the Posts / Comments tabs. This is the
 * ONLY place that mounts `OwnerSections` for a signed-in account, and it is
 * reached only for the viewer's own profile.
 */
export function OwnProfile({ profile, actions, inStack = false }: OwnProfileProps) {
  const { spacing } = useTheme();
  const summary = useMySummary();

  if (profile) {
    return (
      <View testID="own-profile">
        <PublicProfileView
          profile={profile}
          actions={actions}
          moreInHeader={inStack}
          self={{ reports: summary.counts.reports, badgeTotal: summary.badges.length }}
          ownerSection={<OwnerSections />}
        />
      </View>
    );
  }
  return (
    <View style={{ gap: spacing[4] }} testID="own-profile">
      <View style={{ gap: spacing[4] }} testID="own-profile-local">
        <ProfileHeader memberSince={summary.memberSince} roles={summary.roles} />
        <ProfileCounts
          reports={summary.counts.reports}
          comments={summary.counts.comments}
        />
        <EarnedBadges
          variant="row"
          entries={summary.badges.filter((entry) => entry.earned)}
          seeAllCount={summary.badges.length}
        />
      </View>
      <OwnerSections />
    </View>
  );
}
