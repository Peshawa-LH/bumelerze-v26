import { Stack, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";

import { EmptyStateScreen } from "@/components/EmptyStateScreen";

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();

  return (
    <>
      <Stack.Screen options={{ title: t("eventDetail.title") }} />
      <EmptyStateScreen
        title={t("eventDetail.title")}
        description={t("eventDetail.emptyState", { id })}
      />
    </>
  );
}
