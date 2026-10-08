import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { formatAbsoluteDual, formatMagnitudeValue } from "@/features/events/format";
import { placeLine } from "@/features/geo/place-line";
import { useTheme } from "@/theme";
import type { PostEvent } from "../types";

interface EventPostCardProps {
  event: PostEvent;
  /** Off in the share preview (the event page is already open). */
  interactive?: boolean;
  testID?: string;
}

/**
 * The earthquake inside an event post: magnitude, place and time, and a tap
 * that opens the event page. The place line is ours, written from the
 * epicentre in the reader's language (as on every event screen, never the
 * provider's string). Only public event data is shown, never where the
 * person was. An event that is no longer listed reads as a short note.
 */
export function EventPostCard({
  event,
  interactive = true,
  testID = "event-post-card",
}: EventPostCardProps) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const locale = i18n.language;

  const box = [
    styles.card,
    {
      borderColor: colors.border.default,
      backgroundColor: colors.surface.base,
      padding: spacing[3],
      gap: spacing[1],
    },
  ];

  if (event.ref === null) {
    return (
      <View style={box} testID={testID}>
        <Text
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyMeta.fontSize,
            lineHeight: typography.bodyMeta.lineHeight,
            fontStyle: "italic",
          }}
          testID={`${testID}-gone`}
        >
          {t("posts.event.unavailable")}
        </Text>
      </View>
    );
  }

  const magnitude =
    event.magnitude !== null
      ? t("events.magnitudeDisplay", {
          value: formatMagnitudeValue(event.magnitude, locale),
        })
      : null;
  const time =
    event.time !== null ? formatAbsoluteDual(event.time, locale, t).local : null;
  const place =
    event.lat !== null && event.lon !== null
      ? placeLine({ lat: event.lat, lon: event.lon }, locale, t)
      : null;
  const label = [magnitude, place, time]
    .filter((part): part is string => part !== null && part !== "")
    .join(", ");

  const content = (
    <>
      <Text
        style={[typography.labelButton, { color: colors.text.secondary }]}
        numberOfLines={1}
      >
        {t("posts.event.label")}
      </Text>
      {magnitude ? (
        <Text
          testID={`${testID}-magnitude`}
          style={{
            color: colors.text.primary,
            fontSize: typography.h3.fontSize,
            lineHeight: typography.h3.lineHeight,
            fontWeight: typography.h3.fontWeight,
          }}
        >
          {magnitude}
        </Text>
      ) : null}
      {place ? (
        <Text
          testID={`${testID}-place`}
          numberOfLines={2}
          style={{
            color: colors.text.primary,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
            textAlign: "auto",
          }}
        >
          {place}
        </Text>
      ) : null}
      {time ? (
        <Text
          testID={`${testID}-time`}
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyMeta.fontSize,
            lineHeight: typography.bodyMeta.lineHeight,
          }}
        >
          {time}
        </Text>
      ) : null}
    </>
  );

  if (!interactive) {
    return (
      <View style={box} testID={testID} accessible accessibilityLabel={label}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={t("posts.event.open", { event: label })}
      onPress={() => router.push(`/event/${event.ref as string}`)}
      style={box}
      testID={testID}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, minHeight: 44 },
});
