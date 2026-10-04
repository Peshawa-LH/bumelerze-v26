import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { SettingsRow } from "@/features/account/components/SettingsRow";
import { useTheme } from "@/theme";

/** The HomeBase line of the settings group: pin icon, "HomeBase", the town at
 * the end, and a small compass mark when the town was set automatically.
 * Presentational; `HomeBaseSection` owns the logic and the picker below. */
export function HomeBaseRow({
  townName,
  isAuto,
  expanded,
  onToggle,
}: {
  /** Town in the reader's language; null when not set. */
  townName: string | null;
  isAuto: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const value = townName ?? t("onboarding.homeBase.notSet");
  const title = t("settings.homeBaseSectionTitle");
  const autoLabel = t("myData.rows.auto");
  return (
    <SettingsRow
      icon="location-outline"
      label={title}
      value={value}
      accessibilityLabel={
        isAuto ? `${title}, ${value}, ${autoLabel}` : `${title}, ${value}`
      }
      valueAccessory={
        isAuto ? (
          <View
            testID="homebase-auto-mark"
            accessible={false}
            importantForAccessibility="no"
          >
            <Ionicons name="navigate-circle" size={16} color={colors.text.secondary} />
          </View>
        ) : null
      }
      trailing="expand"
      expanded={expanded}
      onPress={onToggle}
      testID="homebase-row"
    />
  );
}
