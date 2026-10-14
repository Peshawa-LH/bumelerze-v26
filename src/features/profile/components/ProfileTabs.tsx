import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";

export type ProfileTab = "posts" | "comments";

/** "Posts" and "Comments" under a profile's header (mockup 3b): two equal
 * tabs, the open one underlined in the brand colour and bold. */
export function ProfileTabs({
  value,
  onChange,
}: {
  value: ProfileTab;
  onChange: (tab: ProfileTab) => void;
}) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const tabs: { key: ProfileTab; label: string }[] = [
    { key: "posts", label: t("posts.title") },
    { key: "comments", label: t("community.profile.comments") },
  ];
  return (
    <View
      accessibilityRole="tablist"
      style={[styles.row, { borderBottomColor: colors.border.subtle }]}
      testID="profile-tabs"
    >
      {tabs.map((tab) => {
        const selected = tab.key === value;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(tab.key)}
            style={[
              styles.tab,
              {
                borderBottomColor: selected ? colors.brand.primary : "transparent",
              },
            ]}
            testID={`profile-tab-${tab.key}`}
          >
            <Text
              style={[
                typography.labelButton,
                {
                  color: selected ? colors.text.primary : colors.text.secondary,
                  fontWeight: selected ? "700" : "500",
                },
              ]}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  tab: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 2,
  },
});
