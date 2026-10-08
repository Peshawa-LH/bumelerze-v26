import { ScrollView, StyleSheet, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { EventHubTransport } from "@/features/eventhub/transport";
import type { PostsTransport } from "@/features/posts/transport";
import { useTheme } from "@/theme";
import { useAdminAccess } from "../queries";
import type { AdminTransport } from "../transport";
import { PasswordResetSection } from "./PasswordResetSection";
import { ModerationQueueSection } from "./ModerationQueueSection";
import { RankBadgesSection } from "./RankBadgesSection";
import { ReportedPostsSection } from "./ReportedPostsSection";
import { ReportedProfilesSection } from "./ReportedProfilesSection";

/** The hidden admin screen. Each section appears only for the permission it
 * needs (`comments.moderate` for the queue and reported profiles,
 * `badges.grant` for rank badges, `accounts.reset_password` for password
 * resets), and everything is hidden for people
 * without any, so a stray link shows nothing. */
export function AdminContent({
  transport,
  hubTransport,
  postsTransport,
}: {
  transport?: AdminTransport;
  hubTransport?: EventHubTransport;
  postsTransport?: PostsTransport;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const access = useAdminAccess(hubTransport);
  const shared = {
    ...(transport ? { transport } : {}),
    ...(hubTransport ? { hubTransport } : {}),
  };

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.content,
        {
          gap: spacing[5],
          padding: spacing[4],
          paddingBottom: insets.bottom + spacing[6],
        },
      ]}
    >
      {access.any || access.isLoading ? null : (
        <Text
          testID="admin-no-access"
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
          }}
        >
          {t("community.errors.forbidden")}
        </Text>
      )}
      {access.canModerate ? (
        <>
          <ModerationQueueSection canDelete={access.canDelete} {...shared} />
          <ReportedProfilesSection {...shared} />
          <ReportedPostsSection
            canRemove={access.canRemovePosts}
            {...shared}
            {...(postsTransport ? { postsTransport } : {})}
          />
        </>
      ) : null}
      {access.canGrant ? <RankBadgesSection {...shared} /> : null}
      {access.canResetPasswords ? (
        <PasswordResetSection {...(transport ? { transport } : {})} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: 560, alignSelf: "center" },
});
