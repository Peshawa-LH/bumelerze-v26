import Ionicons from "@expo/vector-icons/Ionicons";
import type { TFunction } from "i18next";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useAdminHiddenEvents } from "@/features/admin/hidden-events/queries";
import type {
  AdminHiddenEvent,
  HiddenEventsAdminTransport,
} from "@/features/admin/hidden-events/transport";
import { isolateValue } from "@/features/events/format";
import type { HiddenEarthquake } from "@/features/home-extras";
import { directionProps } from "@/i18n";
import { nativeFontFamily, READING_START, useTheme } from "@/theme";

/** {reason} of wording 2.6 and 2.23: the option label of 2.11; for "Other"
 * the admin's note (the label when there is none), isolated: it may be in
 * another script than the sentence around it. */
export function hiddenReasonText(
  t: TFunction,
  row: Pick<AdminHiddenEvent, "reason" | "note">,
): string {
  if (row.reason === "other" && row.note) {
    return isolateValue(row.note);
  }
  return t(`admin.hiddenEvents.reasons.${row.reason}`);
}

/**
 * Banner 2.23, on the page of an earthquake hidden for everyone, which only
 * admins with `events.hide` can open (owner choice 4). The admin's reason
 * and note come from the admin list (`admin_hidden_events()`, the same read
 * as Admin > Hidden earthquakes); until it answers, or when it cannot, a
 * second card says "Two cards for one earthquake" and any other one
 * "Earthquake removed", which is all every phone knows.
 */
export function HiddenEventBanner({
  hidden,
  transport,
}: {
  hidden: HiddenEarthquake;
  /** Test seam for `admin_hidden_events()` (migration 0085). */
  transport?: HiddenEventsAdminTransport;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const list = useAdminHiddenEvents(true, transport);
  const row = hidden.bumelerzeId
    ? list.data?.find((entry) => entry.bumelerzeId === hidden.bumelerzeId)
    : undefined;
  const reason = row
    ? hiddenReasonText(t, row)
    : hidden.reasonKind === "duplicate"
      ? t("admin.hiddenEvents.reasons.duplicate")
      : t("eventDetail.removedTitle");
  return (
    <View
      testID="hidden-event-banner"
      accessibilityRole="alert"
      style={[
        styles.banner,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.status.warning,
          padding: spacing[3],
          gap: spacing[2],
        },
      ]}
    >
      <Ionicons
        name="eye-off-outline"
        size={20}
        color={colors.status.warning}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <Text
        {...directionProps(i18n.language)}
        style={[
          styles.text,
          {
            color: colors.text.primary,
            fontSize: typography.bodyDefault.fontSize,
            fontFamily: nativeFontFamily(typography.bodyDefault),
            ...READING_START,
            lineHeight: typography.bodyDefault.lineHeight,
          },
        ]}
      >
        {t("eventDetail.hiddenBanner", { reason })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderWidth: 1,
    borderRadius: 12,
  },
  text: { flex: 1 },
});
