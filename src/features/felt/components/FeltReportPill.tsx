import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Event } from "@/features/events";
import { useTheme } from "@/theme";

import {
  encodeEventRegistrationParam,
  toEventRegistration,
} from "../event-registration";

interface FeltReportPillProps {
  /** Null/omitted = Home usage (association resolved at tap time by the
   * caller via `resolveHomeFeltAssociation`, passed in as this prop so the
   * pill itself stays a dumb navigation trigger); a specific event id from
   * Event Detail associates directly to that event (wave brief point 4). */
  eventId?: string | null;
  /**
   * The full already-cached `Event` behind `eventId`, when the caller has
   * one (Event Detail always does; Home has one whenever
   * `resolveHomeFeltAssociation` found a match). Serialized into the route
   * as `eventReg` — a JSON string, not a live object reference, since Expo
   * Router params are string-only — so window 1
   * (`app/felt-report/index.tsx`) can resolve the report to the canonical
   * server event uuid at submit time (migration 0011) without a second
   * data fetch. Building this snapshot here is a pure/local operation (no
   * network call), so it doesn't affect the one-tap panic-time promise.
   */
  event?: Event | null;
}

/**
 * The persistent one-tap felt-report entry point (D8: "persistent one-tap
 * entry point on every screen"; LastQuake pattern). Present on Home and
 * Event Detail this wave — Map gets it once Phase 3 builds the Map screen
 * (spec-v1.md §4.4 lists it as a felt-CTA host too; TODO left there, not
 * here, since the Map screen doesn't exist yet).
 */
export function FeltReportPill({ eventId = null, event = null }: FeltReportPillProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("felt.pill.label")}
      accessibilityHint={t("felt.pill.hint")}
      onPress={() =>
        router.push(
          eventId
            ? {
                pathname: "/felt-report",
                params: {
                  eventId,
                  ...(event
                    ? {
                        eventReg: encodeEventRegistrationParam(
                          toEventRegistration(event),
                        ),
                      }
                    : {}),
                },
              }
            : { pathname: "/felt-report" },
        )
      }
      style={({ pressed }) => [
        styles.pill,
        {
          end: spacing[4],
          bottom: insets.bottom + spacing[4],
          backgroundColor: colors.action.felt,
          paddingHorizontal: spacing[5],
          // spacing[4] (not spacing[3]) — this is the primary panic-time CTA
          // (design-language.md §8: "must sit inside the one-handed thumb
          // zone"), so its tap target must clear 48dp with real margin, not
          // sit right at the 44pt floor (spacing[3] measured ~44pt with this
          // label's line height, before font-scaling even grows it).
          paddingVertical: spacing[4],
          minHeight: 48,
          justifyContent: "center",
          opacity: pressed ? 0.9 : 1,
        },
      ]}
    >
      <Text
        allowFontScaling
        style={{
          color: colors.action.feltOnFill,
          fontSize: typography.labelButton.fontSize,
          fontWeight: typography.labelButton.fontWeight,
        }}
      >
        {t("felt.pill.label")}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: "absolute",
    borderRadius: 999,
    elevation: 4,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
});
