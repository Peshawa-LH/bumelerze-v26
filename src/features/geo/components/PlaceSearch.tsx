import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

// Concrete module, not the `@/features/location` barrel: the barrel pulls in
// the prefs store, which imports geo (a require cycle).
import { useUserDistanceAnchor } from "@/features/location/use-user-distance-anchor";
import { useTheme } from "@/theme";
import { MAIN_TOWNS } from "../main-towns";
import { placeDetailLine, isolateName } from "../place-detail";
import {
  nearbyPlaces,
  placeDisplayName,
  searchPlaces,
  type LatLonPoint,
  type Place,
} from "../place-search";
import { usePlaceIndex } from "../use-place-index";

interface PlaceSearchProps {
  /** The place currently chosen, shown as selected in the list. */
  selectedPlaceId?: string | null;
  onSelect: (place: Place) => void;
  /** Where the reader is, for "Nearby" and for ordering equal matches. The
   * device fix is used when this is not given. */
  near?: LatLonPoint | null;
  testID?: string;
}

/**
 * One search field and a short list of results. Typing searches every name of
 * every place in any script; with nothing typed it offers quick picks: the
 * nearest towns to the device, or the main towns when there is no fix. It
 * only reads an already-granted location, it never asks for permission.
 */
export function PlaceSearch({
  selectedPlaceId = null,
  onSelect,
  near,
  testID = "place-search",
}: PlaceSearchProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const index = usePlaceIndex();
  const anchor = useUserDistanceAnchor();
  const [query, setQuery] = useState("");

  const fix = useMemo<LatLonPoint | null>(() => {
    if (near !== undefined) {
      return near;
    }
    return anchor.hasFix ? { lat: anchor.lat, lon: anchor.lon } : null;
  }, [near, anchor]);

  const isSearching = query.trim() !== "";

  const places = useMemo<Place[]>(() => {
    if (!index) {
      return [];
    }
    if (isSearching) {
      return searchPlaces(index, query, { near: fix }).map((result) => result.place);
    }
    if (fix) {
      return nearbyPlaces(index, fix);
    }
    return MAIN_TOWNS.flatMap((town) => {
      const place = index.byId.get(town.id);
      return place ? [place] : [];
    });
  }, [index, query, isSearching, fix]);

  const heading = isSearching
    ? null
    : fix
      ? t("placeSearch.nearby")
      : t("placeSearch.mainTowns");

  return (
    <View style={{ gap: spacing[2] }} testID={testID}>
      <View
        style={[
          styles.field,
          {
            borderColor: colors.border.default,
            backgroundColor: colors.surface.raised,
            paddingHorizontal: spacing[3],
          },
        ]}
      >
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t("placeSearch.label")}
          placeholderTextColor={colors.text.tertiary}
          accessibilityLabel={t("placeSearch.label")}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          testID={`${testID}-input`}
          style={[
            styles.input,
            {
              color: colors.text.primary,
              fontSize: typography.bodyDefault.fontSize,
              textAlign: "auto",
              writingDirection: "auto",
            },
          ]}
        />
        {isSearching ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("placeSearch.clear")}
            onPress={() => setQuery("")}
            hitSlop={8}
            style={styles.clear}
            testID={`${testID}-clear`}
          >
            <Text
              style={{
                color: colors.text.secondary,
                fontSize: typography.bodyDefault.fontSize,
              }}
            >
              ×
            </Text>
          </Pressable>
        ) : null}
      </View>

      {heading ? (
        <Text
          accessibilityRole="header"
          style={{
            color: colors.text.secondary,
            fontSize: typography.labelCaption.fontSize,
            fontWeight: typography.labelCaption.fontWeight,
          }}
        >
          {heading}
        </Text>
      ) : null}

      {index && isSearching && places.length === 0 ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyMeta.fontSize,
            paddingVertical: spacing[2],
          }}
        >
          {t("placeSearch.noResults")}
        </Text>
      ) : null}

      {places.map((place) => {
        const isActive = place.id === selectedPlaceId;
        const name = placeDisplayName(place, i18n.language);
        const detail = placeDetailLine(place, i18n.language, t);
        return (
          <Pressable
            key={place.id}
            accessibilityRole="button"
            accessibilityLabel={t("placeSearch.resultLabel", {
              name: isolateName(name),
              detail,
            })}
            accessibilityState={{ selected: isActive }}
            onPress={() => onSelect(place)}
            testID={`${testID}-result-${place.id}`}
            style={[
              styles.row,
              {
                borderColor: colors.border.default,
                backgroundColor: isActive ? colors.surface.raised : "transparent",
                paddingVertical: spacing[2],
                paddingHorizontal: spacing[3],
              },
            ]}
          >
            <Text
              numberOfLines={1}
              style={{
                color: colors.text.primary,
                fontSize: typography.bodyDefault.fontSize,
                fontWeight: isActive ? "700" : "400",
              }}
            >
              {name}
            </Text>
            <Text
              numberOfLines={1}
              style={{
                color: colors.text.tertiary,
                fontSize: typography.labelCaption.fontSize,
              }}
            >
              {detail}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 48,
  },
  input: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 8,
  },
  clear: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    borderWidth: 1,
    borderRadius: 8,
    minHeight: 48,
    justifyContent: "center",
  },
});
