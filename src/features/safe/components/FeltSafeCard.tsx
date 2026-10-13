import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import {
  encodeEventRegistrationParam,
  useFeltQueueStore,
  type EventRegistration,
} from "@/features/felt";
import { useTheme } from "@/theme";

import { feltPromptKind } from "../relevance";
import { CheckInPanel } from "./CheckInPanel";

/** Damage grade from which the "cannot send help" statement comes first. */
const NOTICE_FIRST_FROM_DAMAGE_GRADE = 3;

/**
 * The check-in invitation on the felt-report done screen (entry T1). Never
 * a new window in the felt flow, and never an automatic check-in: reporting
 * shaking does not mean the person is safe.
 *
 * Level V and up: the full "Are you safe?" panel. III-IV: one quiet link to
 * the check-in screen. II and below: nothing. Either way the check-in carries
 * the report (review note 3.3): it is real even without a regional M4.0,
 * tied to the report's earthquake when it has one, else to the report.
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
    return (
      <QuietLink
        event={queued.tier1.eventRegistration}
        reportId={queued.tier1.reportId}
      />
    );
  }
  const damage = queued.tier2?.answers.buildingDamageLevel ?? null;
  return (
    <PrimaryCard
      reportEvent={queued.tier1.eventRegistration}
      reportId={queued.tier1.reportId}
      noticeFirst={damage !== null && damage >= NOTICE_FIRST_FROM_DAMAGE_GRADE}
    />
  );
}

function QuietLink({
  event,
  reportId,
}: {
  event: EventRegistration | null;
  reportId: string;
}) {
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
          params: event
            ? { event: encodeEventRegistrationParam(event), report: reportId }
            : { report: reportId },
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
  reportId,
  noticeFirst,
}: {
  reportEvent: EventRegistration | null;
  reportId: string;
  noticeFirst: boolean;
}) {
  const { colors, spacing } = useTheme();
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
      <CheckInPanel
        event={reportEvent}
        feltReportId={reportId}
        noticeFirst={noticeFirst}
      />
    </View>
  );
}
