import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useRegionEvents } from "@/features/events";
import {
  encodeEventRegistrationParam,
  toEventRegistration,
  useFeltQueueStore,
  type EventRegistration,
} from "@/features/felt";
import { useTheme } from "@/theme";

import { feltPromptKind, pickManualEvent } from "../relevance";
import { CheckInPanel } from "./CheckInPanel";

/** Damage grade from which the "cannot send help" statement comes first. */
const NOTICE_FIRST_FROM_DAMAGE_GRADE = 3;

/**
 * The check-in invitation on the felt-report done screen (entry T1). Never
 * a new window in the felt flow, and never an automatic check-in: reporting
 * shaking does not mean the person is safe.
 *
 * Level V and up: the full "Are you safe?" panel. III-IV: one quiet link to
 * the check-in screen. II and below: nothing.
 */
export function FeltSafeCard({ feltReportId }: { feltReportId: string | null }) {
  const queued = useFeltQueueStore((s) =>
    feltReportId
      ? (s.items.find((item) => item.tier1.reportId === feltReportId) ?? null)
      : null,
  );
  const kind = feltPromptKind(queued?.tier1.cartoonLevel);
  if (!queued || kind === "none") {
    return null;
  }
  if (kind === "quiet") {
    return <QuietLink event={queued.tier1.eventRegistration} />;
  }
  const damage = queued.tier2?.answers.buildingDamageLevel ?? null;
  return (
    <PrimaryCard
      reportEvent={queued.tier1.eventRegistration}
      noticeFirst={damage !== null && damage >= NOTICE_FIRST_FROM_DAMAGE_GRADE}
    />
  );
}

function QuietLink({ event }: { event: EventRegistration | null }) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const router = useRouter();
  return (
    <Pressable
      testID="felt-safe-link"
      accessibilityRole="link"
      accessibilityLabel={t("imSafe.action.feltLink")}
      onPress={() =>
        router.push({
          pathname: "/im-safe",
          params: event ? { event: encodeEventRegistrationParam(event) } : {},
        })
      }
      style={{ minHeight: 48, justifyContent: "center" }}
    >
      <Text style={[typography.labelButton, { color: colors.text.link }]}>
        {t("imSafe.action.feltLink")}
      </Text>
    </Pressable>
  );
}

function PrimaryCard({
  reportEvent,
  noticeFirst,
}: {
  reportEvent: EventRegistration | null;
  noticeFirst: boolean;
}) {
  const { colors, spacing } = useTheme();
  const { events } = useRegionEvents();
  // The report's own earthquake; otherwise the newest qualifying regional one.
  const manual = reportEvent ? null : pickManualEvent(events);
  const event = reportEvent ?? (manual ? toEventRegistration(manual) : null);
  return (
    <View
      testID="felt-safe-card"
      style={{
        borderWidth: 1,
        borderRadius: 14,
        borderColor: colors.border.default,
        backgroundColor: colors.surface.raised,
        padding: spacing[4],
      }}
    >
      <CheckInPanel event={event} noticeFirst={noticeFirst} />
    </View>
  );
}
