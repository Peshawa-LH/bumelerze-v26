import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { SettingsGroup } from "@/features/account/components/SettingsGroup";
import { SettingsRow } from "@/features/account/components/SettingsRow";
import { BadgeIcon, MILESTONE_BADGES } from "@/features/badges";
import { useTheme } from "@/theme";

/** Three earned badges and one still locked, so both looks are shown. */
const SAMPLE_BADGES: readonly { id: string; earned: boolean }[] = [
  { id: "first_report", earned: true },
  { id: "photo", earned: true },
  { id: "first_comment", earned: true },
  { id: "home_tagged", earned: false },
];
const BADGE_SIZE = 56;

/** My account: some badge circles and the "Tag my building" row. */
export function AccountPreview() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  return (
    <View style={{ gap: spacing[4] }}>
      <View style={{ flexDirection: "row", justifyContent: "center", gap: spacing[3] }}>
        {SAMPLE_BADGES.map(({ id, earned }) => {
          const badge = MILESTONE_BADGES.find((candidate) => candidate.id === id);
          if (!badge) {
            return null;
          }
          return (
            <BadgeIcon
              key={id}
              glyph={earned ? badge.icon : badge.iconOutline}
              tone={badge.tone}
              earned={earned}
              size={BADGE_SIZE}
            />
          );
        })}
      </View>
      <SettingsGroup>
        <SettingsRow icon="home-outline" label={t("building.title")} />
      </SettingsGroup>
    </View>
  );
}
