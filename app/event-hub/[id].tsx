import { Stack, useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { isBumelerzeId } from "@/features/events";
import { EventHubContent, useRouteEvent } from "@/features/eventhub";
import { ShareButton, shareIdFor } from "@/features/share";
import { useTheme } from "@/theme";

/**
 * Event hub: who felt this earthquake and what they said. Opened from the
 * "Who felt it?" pill on `/event/[id]` with the same id (a `bml` id, or a
 * provider id for older links), so the event resolves exactly as it does on
 * the event page. The body is `EventHubContent`.
 */
export default function EventHubScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const { event, isLoading, isNotFound } = useRouteEvent(id);

  const bodyStyle = {
    color: colors.text.secondary,
    fontSize: typography.bodyDefault.fontSize,
    lineHeight: typography.bodyDefault.lineHeight,
  } as const;

  return (
    <>
      <Stack.Screen
        options={{
          title: t("eventHub.title"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
          headerRight: () =>
            event ? (
              <ShareButton
                event={event}
                shareId={shareIdFor(event, id && isBumelerzeId(id) ? id : null)}
              />
            ) : null,
        }}
      />
      <View style={{ flex: 1, backgroundColor: colors.surface.base }}>
        {event ? <EventHubContent event={event} /> : null}
        {isLoading ? (
          <Text style={[bodyStyle, { padding: spacing[5] }]}>{t("eventDetail.loading")}</Text>
        ) : null}
        {isNotFound ? (
          <Text style={[bodyStyle, { padding: spacing[5] }]}>
            {t("eventDetail.notFoundTitle")}
          </Text>
        ) : null}
      </View>
    </>
  );
}
