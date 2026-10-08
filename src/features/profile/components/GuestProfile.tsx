import { View } from "react-native";

import { ProfileHeader } from "@/features/account/components/ProfileHeader";
import { SettingsGroup } from "@/features/account/components/SettingsGroup";
import { PrivacyRow } from "@/features/account/components/PrivacyRow";
import { SignUpInvite } from "@/features/account/components/SignUpInvite";
import { useAccount } from "@/features/account/use-account";
import { useMySummary } from "@/features/account/use-my-summary";
import { EarnedBadges } from "@/features/badges";
import { MyHomeCard } from "@/features/building";
import { MyReportsSection } from "@/features/mydata";
import { useTheme } from "@/theme";

/**
 * The Profile tab for an install without an account (or with no server): a
 * grey "Guest" header, the one sign-up invitation, then what a guest has on
 * this device: earned badges, the home card (a locked preview), felt reports
 * and the contributor ID. No posts and no follow counts: they need an account.
 */
export function GuestProfile() {
  const { spacing } = useTheme();
  const account = useAccount();
  const summary = useMySummary();
  return (
    <View style={{ gap: spacing[4] }} testID="guest-profile">
      <ProfileHeader memberSince={null} roles={[]} />
      {account.status === "anonymous" ? <SignUpInvite /> : null}
      <EarnedBadges
        entries={summary.badges.filter((entry) => entry.earned)}
        seeAllCount={summary.badges.length}
      />
      <MyHomeCard />
      <MyReportsSection />
      <SettingsGroup>
        <PrivacyRow email={null} />
      </SettingsGroup>
    </View>
  );
}
