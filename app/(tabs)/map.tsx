import { useTranslation } from "react-i18next";

import { EmptyStateScreen } from "@/components/EmptyStateScreen";

export default function MapScreen() {
  const { t } = useTranslation();
  return (
    <EmptyStateScreen title={t("map.title")} description={t("map.emptyState")} />
  );
}
