import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { formatAbsoluteDual, isolateNumeric, type Event } from "@/features/events";
import { placeLine } from "@/features/geo";
import { useTheme } from "@/theme";
import { useFeltMap } from "../queries";
import { FeltMapView } from "./FeltMapView";

export interface FeltMapSectionProps {
  event: Event;
}

/**
 * Event Detail's felt-map section (spec-v1.md §4.5 "Felt map tab: our own
 * CDI-aggregated grid cells"), mounted as a sibling of `ShakeMapSection`
 * (`app/event/[id].tsx`, below it). Three states, matching the wave brief
 * exactly:
 *  - `"hidden"` (`useFeltMap`): renders nothing at all — no Supabase
 *    project configured yet, OR configured but this event has no
 *    displayable cells yet (spec-v1.md §4.5: "no empty-state noise on old
 *    events" is the wave brief's own phrasing for this case).
 *  - `"offline"`: the spec-v1.md §4.5 offline state ("ShakeMap/felt-map
 *    /comments show 'unavailable offline' rather than blank/error") — a
 *    short message plus a retry affordance, never a silent failure (no
 *    silent catches — repo rule).
 *  - `"ready"`: the map itself, plus an "Updated {time}" line and a
 *    citation, the same two-line footer shape `ShakeMapSection` uses.
 */
export function FeltMapSection({ event }: FeltMapSectionProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const feltMap = useFeltMap(event.id);

  if (feltMap.status === "hidden") {
    return null;
  }

  const titleStyle = {
    color: colors.text.secondary,
    fontSize: typography.labelCaption.fontSize,
    lineHeight: typography.labelCaption.lineHeight,
    fontWeight: typography.labelCaption.fontWeight,
  } as const;
  const bodyStyle = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  if (feltMap.status === "offline") {
    return (
      <View style={{ gap: spacing[2] }}>
        <Text style={titleStyle}>{t("eventDetail.feltMap.sectionTitle")}</Text>
        <View
          style={[
            styles.offlineBox,
            {
              backgroundColor: colors.surface.sunken,
              borderColor: colors.border.default,
              padding: spacing[4],
              gap: spacing[2],
            },
          ]}
        >
          <View style={[styles.offlineRow, { gap: spacing[2] }]}>
            <Ionicons
              name="cloud-offline-outline"
              size={16}
              color={colors.text.secondary}
            />
            <Text style={[bodyStyle, styles.offlineText]}>
              {t("eventDetail.feltMap.unavailableOffline")}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={feltMap.refetch}
            hitSlop={12}
          >
            <Text
              style={{
                color: colors.text.link,
                fontSize: typography.bodyMeta.fontSize,
                fontWeight: "600",
              }}
            >
              {t("eventDetail.feltMap.retry")}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const { local: updatedLocal } = formatAbsoluteDual(
    feltMap.dataUpdatedAt,
    i18n.language,
    t,
  );
  const placeText = placeLine(event, i18n.language, t);

  return (
    <View style={{ gap: spacing[2] }}>
      <Text style={titleStyle}>{t("eventDetail.feltMap.sectionTitle")}</Text>
      <FeltMapView
        cells={feltMap.cells}
        epicenter={{ lat: event.lat, lon: event.lon }}
        locale={i18n.language}
        t={t}
        placeText={placeText}
      />
      <View style={{ gap: spacing[1] }}>
        <Text style={bodyStyle}>
          {t("eventDetail.feltMap.updated", { time: isolateNumeric(updatedLocal) })}
        </Text>
        <Text style={bodyStyle}>{t("eventDetail.feltMap.citation")}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  offlineBox: {
    borderWidth: 1,
    borderRadius: 12,
  },
  offlineRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  offlineText: {
    flexShrink: 1,
  },
});
