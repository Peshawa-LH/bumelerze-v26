import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { useTranslation } from "react-i18next";

import { gazetteerPlaceById, placeDisplayName, usePlaceIndex } from "@/features/geo";
import { PlaceSearch } from "@/features/geo/components/PlaceSearch";
import { isolateName } from "@/features/geo/place-detail";
import {
  switchToDeviceLocation,
  useLocationPermissionGranted,
} from "@/features/location";
import { usePrefsStore } from "@/features/onboarding";
import { DEFAULT_PLACE_ID } from "@/features/geo/main-towns";
import type { Place } from "@/features/geo/place-search";
import { useTheme } from "@/theme";
import { SettingsRow, SettingsRowBody } from "./SettingsRow";

/**
 * "My location": where the app thinks the reader is. One short value line (the
 * place in the app language, never coordinates) and an inline body with "Use
 * my location" and the place search. Choosing a place makes it the reader's own
 * choice, which the daily location check never replaces; "Use my location"
 * goes back to following the device.
 */
export function MyLocationRow() {
  const { t, i18n } = useTranslation();
  const { colors, typography } = useTheme();
  const index = usePlaceIndex();
  const referencePlace = usePrefsStore((state) => state.referencePlace);
  const source = usePrefsStore((state) => state.referenceSource);
  const chooseReferencePlace = usePrefsStore((state) => state.chooseReferencePlace);
  const permissionGranted = useLocationPermissionGranted();
  const [grantedNow, setGrantedNow] = useState<boolean | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [denied, setDenied] = useState(false);

  const granted = grantedNow ?? permissionGranted === true;
  const placeId = referencePlace?.placeId ?? DEFAULT_PLACE_ID;
  const place: Place | null =
    index?.byId.get(placeId) ?? gazetteerPlaceById(placeId) ?? null;
  const name = isolateName(place ? placeDisplayName(place, i18n.language) : placeId);

  const value =
    source === "manual"
      ? t("myData.location.valueManual", { place: name })
      : granted
        ? t("myData.location.valueNear", { place: name })
        : t("myData.location.valueOff", { place: name });

  const showUseLocation = !(source === "auto" && granted);

  async function handleUseLocation() {
    setRequesting(true);
    setDenied(false);
    try {
      const result = await switchToDeviceLocation();
      if (result === "granted") {
        setGrantedNow(true);
        setExpanded(false);
      } else {
        setGrantedNow(false);
        setDenied(true);
      }
    } finally {
      setRequesting(false);
    }
  }

  function handleSelect(chosen: Place) {
    chooseReferencePlace({ placeId: chosen.id, lat: chosen.lat, lon: chosen.lon });
    setDenied(false);
    setExpanded(false);
  }

  return (
    <>
      <SettingsRow
        icon="location-outline"
        label={t("myData.location.title")}
        value={value}
        trailing="expand"
        expanded={expanded}
        onPress={() => setExpanded((open) => !open)}
        testID="account-location-row"
      />
      {expanded ? (
        <SettingsRowBody>
          {showUseLocation ? (
            <Pressable
              testID="account-location-use"
              accessibilityRole="button"
              accessibilityLabel={t("myData.location.use")}
              accessibilityState={{ disabled: requesting }}
              disabled={requesting}
              onPress={() => void handleUseLocation()}
              hitSlop={12}
              style={styles.linkTarget}
            >
              <Text style={[typography.labelButton, { color: colors.text.link }]}>
                {t("myData.location.use")}
              </Text>
            </Pressable>
          ) : null}
          {denied ? (
            <Text
              testID="account-location-denied"
              accessibilityLiveRegion="polite"
              style={[typography.bodyMeta, { color: colors.text.secondary }]}
            >
              {t("myData.location.denied")}
            </Text>
          ) : null}
          <PlaceSearch
            testID="account-location-search"
            selectedPlaceId={source === "manual" ? placeId : null}
            onSelect={handleSelect}
          />
        </SettingsRowBody>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  // At least 44 px tall tap target for the text link.
  linkTarget: { minHeight: 44, justifyContent: "center" },
});
