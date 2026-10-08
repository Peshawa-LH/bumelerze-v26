import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { placeDisplayName } from "@/features/geo/place-search";
import { usePlaceIndex } from "@/features/geo/use-place-index";
import { useTheme } from "@/theme";
import type { ProfileDetails } from "../types";

/**
 * The bio and "Lives in <place>" under a profile's name (migration 0058).
 * The place is stored as an id from the app's town list plus the name picked
 * at the time; each reader sees it in their own language when the id is in
 * the bundled list, else the stored name. Plain text only: nothing is a link.
 */
export function ProfileAbout({ details }: { details: ProfileDetails }) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const index = usePlaceIndex();

  const city = details.city;
  const known = city && index ? index.byId.get(city.placeId) : undefined;
  const cityName = city
    ? known
      ? placeDisplayName(known, i18n.language)
      : city.name
    : null;

  if (!details.bio && !cityName) {
    return null;
  }
  return (
    <View style={{ gap: spacing[1] }} testID="profile-about">
      {details.bio ? (
        <Text
          testID="profile-bio"
          style={{
            color: colors.text.primary,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
            // follows the language it is written in
            textAlign: "auto",
          }}
        >
          {details.bio}
        </Text>
      ) : null}
      {cityName ? (
        <View style={[styles.row, { gap: spacing[1] }]}>
          <Ionicons name="home-outline" size={14} color={colors.text.secondary} />
          <Text
            testID="profile-city"
            style={{
              color: colors.text.secondary,
              fontSize: typography.bodyMeta.fontSize,
              lineHeight: typography.bodyMeta.lineHeight,
            }}
          >
            {t("community.profile.livesIn", { place: cityName })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
});
