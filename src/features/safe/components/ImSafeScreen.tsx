import { Stack, useRouter } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AccountButton } from "@/features/account/components/AccountButton";
import { HeaderBackButton } from "@/components/HeaderBackButton";
import { useRegionEvents } from "@/features/events";
import { decodeEventRegistrationParam, toEventRegistration } from "@/features/felt";
import { useTheme } from "@/theme";

import { MANUAL_WINDOW_MS } from "../constants";
import { pickManualEvent } from "../relevance";
import { CheckInPanel } from "./CheckInPanel";

/**
 * "I'm safe" on its own screen: from the Family screen (manual, T3) and from
 * the quiet link after a felt report of level III-IV. Attaches to the given
 * earthquake, or to the newest regional M4.0+ of the last 72 hours; with
 * neither it becomes "Practice a check-in" (stored nowhere, shared with
 * nobody), so the check-in never turns into a daily "are you alive" signal.
 * From a felt report (`reportParam`) it is always real: the server ties it
 * to the report's earthquake, or to the report itself (review note 3.3).
 */
export function ImSafeScreen({
  eventParam,
  reportParam,
}: {
  eventParam: string | undefined;
  reportParam?: string | undefined;
}) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { events } = useRegionEvents();

  const fromParam = decodeEventRegistrationParam(eventParam);
  // eslint-disable-next-line react-hooks/purity -- see EventListScreen.tsx's comment on this exact pattern
  const now = Date.now();
  const feltReportId = reportParam ? reportParam : null;
  const usable =
    fromParam && (feltReportId || now - fromParam.originTime <= MANUAL_WINDOW_MS)
      ? fromParam
      : null;
  const manual = usable || feltReportId ? null : pickManualEvent(events);
  const event = usable ?? (manual ? toEventRegistration(manual) : null);

  return (
    <View style={[styles.flex, { backgroundColor: colors.surface.base }]}>
      <Stack.Screen
        options={{
          title: t("imSafe.screenTitle"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <ScrollView
        contentContainerStyle={{
          padding: spacing[5],
          paddingBottom: insets.bottom + spacing[6],
          gap: spacing[4],
        }}
      >
        <CheckInPanel
          event={event}
          feltReportId={feltReportId}
          practice={event === null && feltReportId === null}
          titleLevel={1}
          testID="im-safe-screen"
        />
        <AccountButton
          label={t("imSafe.button.done")}
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          testID="im-safe-done"
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
