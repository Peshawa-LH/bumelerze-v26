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
}

/**
 * The owner's Profile page: the public part (what visitors see, with Edit /
 * Share profile in place of Follow) and, below it, the owner-only sections.
 * This is the ONLY place that mounts `OwnerSections` for a signed-in account,
 * and it is reached only for the viewer's own profile.
 */
export function OwnProfile({ profile, actions }: OwnProfileProps) {
  const { spacing } = useTheme();
  const summary = useMySummary();

  return (
    <View style={{ gap: spacing[4] }} testID="own-profile">
      {profile ? (
        <PublicProfileView
          profile={profile}
          actions={actions}
          self={{ reports: summary.counts.reports, badgeTotal: summary.badges.length }}
        />
      ) : (
        <View style={{ gap: spacing[4] }} testID="own-profile-local">
          <ProfileHeader memberSince={summary.memberSince} roles={summary.roles} />
          <ProfileCounts
            reports={summary.counts.reports}
            comments={summary.counts.comments}
          />
          <EarnedBadges
            entries={summary.badges.filter((entry) => entry.earned)}
            seeAllCount={summary.badges.length}
          />
        </View>
      )}
      <OwnerSections />
    </View>
  );
}
