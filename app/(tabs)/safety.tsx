import { useTranslation } from "react-i18next";

import { EmptyStateScreen } from "@/components/EmptyStateScreen";

export default function SafetyScreen() {
  const { t } = useTranslation();
  return (
    <EmptyStateScreen
      title={t("safety.title")}
      description={t("safety.emptyState")}
    />
  );
}
