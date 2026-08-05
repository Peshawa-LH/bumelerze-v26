import { useTranslation } from "react-i18next";

import { EmptyStateScreen } from "@/components/EmptyStateScreen";

export default function HomeScreen() {
  const { t } = useTranslation();
  return (
    <EmptyStateScreen title={t("home.title")} description={t("home.emptyState")} />
  );
}
