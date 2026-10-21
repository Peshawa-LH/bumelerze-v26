import { Text } from "react-native";
import { useTranslation } from "react-i18next";

import { gazetteerPlaceById, placeDisplayName, usePlaceIndex } from "@/features/geo";
import { isolateName } from "@/features/geo/place-detail";
import { usePrefsStore } from "@/features/onboarding";
import { useTheme, nativeFontFamily } from "@/theme";

import { useAlertPreferencesPayload } from "../prefs-sync";

function useMetaStyle() {
  const { colors, typography } = useTheme();
  return {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    fontFamily: nativeFontFamily(typography.bodyMeta),
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;
}

/**
 * Under "Near me" (alerts enabled only): which place the server uses, the
 * town from My location, or that there is none (abroad / never set).
 */
export function AlertsNearMePlace() {
  const { t, i18n } = useTranslation();
  const meta = useMetaStyle();
  const payload = useAlertPreferencesPayload();
  const referencePlace = usePrefsStore((state) => state.referencePlace);
  const index = usePlaceIndex();

  let placeName: string | null = null;
  if (payload.nearMeLat !== null && referencePlace) {
    const place = index?.byId.get(referencePlace.placeId) ?? gazetteerPlaceById(referencePlace.placeId);
    placeName = isolateName(place ? placeDisplayName(place, i18n.language) : referencePlace.placeId);
  }
  return (
    <Text style={meta} testID="alerts-near-me-where">
      {placeName ? t("alerts.nearMeWhere", { place: placeName }) : t("alerts.nearMeNoPlace")}
    </Text>
  );
}

/** The language a push is written in: the app's. */
export function AlertsLanguageNote() {
  const { t } = useTranslation();
  const meta = useMetaStyle();
  const payload = useAlertPreferencesPayload();
  return (
    <Text style={meta} testID="alerts-language">
      {t("alerts.language", { language: t(`settings.languages.${payload.language}`) })}
    </Text>
  );
}
