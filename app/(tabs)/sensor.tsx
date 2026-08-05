import { useTranslation } from "react-i18next";

import { EmptyStateScreen } from "@/components/EmptyStateScreen";

export default function SensorScreen() {
  const { t } = useTranslation();
  return (
    <EmptyStateScreen
      title={t("sensor.title")}
      description={t("sensor.emptyState")}
    />
  );
}
