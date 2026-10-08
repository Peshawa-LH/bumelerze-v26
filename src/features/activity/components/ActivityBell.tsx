import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useAccount } from "@/features/account/use-account";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";
import { useActivityUnread } from "../queries";
import type { ActivityTransport } from "../transport";

/**
 * The bell at the top of the Profile tab: opens Activity, with the number of
 * new rows (99 at most) on it. Social things never send a push (earthquake
 * alerts stay the only notifications), so this number is the only signal.
 * Hidden for an install with no identity on the server.
 */
export function ActivityBell({ transport }: { transport?: ActivityTransport }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors, typography } = useTheme();
  const account = useAccount();
  const unread = useActivityUnread(transport);

  if (account.userId === null) {
    return null;
  }
  const label =
    unread > 0
      ? t("activity.bellNew", { value: localizeDigits(String(unread), i18n.language) })
      : t("activity.bell");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => router.push("/account/activity")}
      hitSlop={8}
      style={styles.button}
      testID="activity-bell"
    >
      <Ionicons
        name={unread > 0 ? "notifications" : "notifications-outline"}
        size={26}
        color={colors.text.primary}
      />
      {unread > 0 ? (
        <View
          style={[styles.badge, { backgroundColor: colors.status.danger }]}
          testID="activity-bell-count"
        >
          <Text
            style={{
              color: colors.text.inverse,
              fontSize: typography.labelCaption.fontSize,
              fontWeight: "700",
            }}
          >
            {localizeDigits(unread > 9 ? "9+" : String(unread), i18n.language)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  badge: {
    position: "absolute",
    top: 4,
    end: 2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
});
