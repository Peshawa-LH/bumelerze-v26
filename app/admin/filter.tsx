import { Stack } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { ContentFilterContent } from "@/features/contentfilter";
import { useTheme } from "@/theme";

/** Admin > Word filter and busy times (migration 0059). Gated by
 * `filter.manage` (the official account) inside the content; a stray link
 * shows nothing. */
export default function AdminFilterScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface.base }}>
      <Stack.Screen
        options={{
          title: t("contentFilter.title"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <ContentFilterContent />
    </View>
  );
}
