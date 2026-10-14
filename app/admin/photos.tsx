import { Stack } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { lazyScreenContent } from "@/components/LazyScreenContent";
import { loadAdminArea } from "@/features/admin/area-loader";
import { useTheme } from "@/theme";

// On the web, downloaded on first use (src/features/admin/area.ts).
const FeltPhotoQueueContent = lazyScreenContent(
  loadAdminArea,
  (area) => area.FeltPhotoQueueContent,
);

/** Admin > Felt photos: approve or reject photos attached to felt reports
 * (they stay hidden until approved, D15). Gated by `photos.moderate`. */
export default function AdminPhotosScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface.base }}>
      <Stack.Screen
        options={{
          title: t("admin.photos.title"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <FeltPhotoQueueContent />
    </View>
  );
}
