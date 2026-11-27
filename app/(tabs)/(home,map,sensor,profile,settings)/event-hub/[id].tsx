import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { isBumelerzeId } from "@/features/events";
import { EventHubContent, useRouteEvent } from "@/features/eventhub";
import { EarthquakeRemoved } from "@/features/eventhub/components/EarthquakeRemoved";
import { HiddenEventBanner } from "@/features/eventhub/components/HiddenEventBanner";
import { useHiddenRouteGate } from "@/features/eventhub/hidden-route";
import { useTheme, nativeFontFamily, READING_START } from "@/theme";

/**
 * Event hub: the earthquake as a post, with who felt it and what they said.
 * Opened from the "Who felt it?" pill on `/event/[id]` with the same id (a
 * `bml` id, or a provider id for older links), so the event resolves exactly
 * as it does on the event page. The body is `EventHubContent`; sharing lives
 * in its action row and its "..." menu (review note 4.4). An earthquake
 * Bumelerze hid for everyone (migration 0085) is handled as on the event
 * page: the hub of the card that stays, or "Earthquake removed"; admins
 * with `events.hide` see it with banner 2.23.
 */
export default function EventHubScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();
  const route = useRouteEvent(id);
  const gate = useHiddenRouteGate(route.hidden);
  const event = gate.mode === "show" ? route.event : null;
  const isLoading =
    gate.mode === "wait" ||
    gate.mode === "redirect" ||
    (gate.mode === "show" && route.isLoading);
  const isNotFound = gate.mode === "show" && route.isNotFound;
  const keptRouteId = gate.keptRouteId;

  // A second card: the hub of the card that stays, where its felt reports
  // went (wording 2.21).
  useEffect(() => {
    if (keptRouteId) {
      router.replace(`/event-hub/${keptRouteId}`);
    }
  }, [keptRouteId, router]);

  const bodyStyle = {
    color: colors.text.secondary,
    fontSize: typography.bodyDefault.fontSize,
    fontFamily: nativeFontFamily(typography.bodyDefault),
    ...READING_START,
    lineHeight: typography.bodyDefault.lineHeight,
  } as const;

  return (
    <>
      <Stack.Screen
        options={{
          title: t("eventHub.title"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <View style={{ flex: 1, backgroundColor: colors.surface.base }}>
        {event && gate.adminView && route.hidden ? (
          <View style={{ padding: spacing[4], paddingBottom: 0 }}>
            <HiddenEventBanner hidden={route.hidden} />
          </View>
        ) : null}
        {gate.mode === "removed" ? (
          <View style={{ padding: spacing[5] }}>
            <EarthquakeRemoved />
          </View>
        ) : null}
        {event ? (
          <EventHubContent
            event={event}
            bumelerzeId={id && isBumelerzeId(id) ? id : null}
          />
        ) : null}
        {isLoading ? (
          <Text style={[bodyStyle, { padding: spacing[5] }]}>
            {t("eventDetail.loading")}
          </Text>
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
