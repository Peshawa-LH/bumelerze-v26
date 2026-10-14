import { Stack } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { OfficialsContent } from "@/features/authority";
import { useTheme } from "@/theme";

/** The Officials page, for the Government official rank only (`authority.view`,
 * migration 0066): area totals first, then the people who chose to share.
 * Opened from Profile > Only you see this; a stray link shows nothing. */
export default function OfficialsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface.base }}>
      <Stack.Screen
        options={{
          title: t("officials.title"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <OfficialsContent />
    </View>
  );
}
