import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Switch, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { communityErrorText } from "@/features/community/error-text";
import { useTheme } from "@/theme";
import { useAuthoritySharing, useSetAuthoritySharing } from "../queries";
import type { AuthorityTransport } from "../transport";

/**
 * Settings > Account: the account holder's own switch for government
 * officials (migration 0066). Off by default. On: an official with a
 * verified Bumelerze role sees this person's building class, its area (never
 * the address) and their latest I'm safe. Hidden when the server cannot
 * answer (before 0066), so it never shows a switch that does nothing.
 */
export function AuthoritySharingRow({ transport }: { transport?: AuthorityTransport }) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const sharing = useAuthoritySharing(transport);
  const set = useSetAuthoritySharing(transport);
  const dir = { writingDirection: i18n.dir() } as const;
  if (sharing.isError) {
    return null;
  }
  const enabled = sharing.data?.enabled ?? false;
  return (
    <View
      style={[
        styles.row,
        { paddingHorizontal: spacing[4], paddingVertical: spacing[3], gap: spacing[3] },
      ]}
      testID="authority-sharing-row"
    >
      <Ionicons name="business-outline" size={24} color={colors.text.secondary} />
      <View style={styles.text}>
        <Text style={[typography.bodyDefault, dir, { color: colors.text.primary }]}>
          {t("officials.sharing.label")}
        </Text>
        <Text style={[typography.bodyMeta, dir, { color: colors.text.secondary }]}>
          {t("officials.sharing.hint")}
        </Text>
        {set.isError ? (
          <Text
            accessibilityRole="alert"
            style={[typography.bodyMeta, dir, { color: colors.status.danger }]}
            testID="authority-sharing-error"
          >
            {communityErrorText(t, set.error)}
          </Text>
        ) : null}
      </View>
      <Switch
        testID="authority-sharing-switch"
        accessibilityLabel={t("officials.sharing.label")}
        accessibilityHint={t("officials.sharing.hint")}
        value={enabled}
        disabled={sharing.isLoading || set.isPending}
        onValueChange={(on) => set.mutate(on)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", minHeight: 56 },
  text: { flex: 1, gap: 2 },
});
