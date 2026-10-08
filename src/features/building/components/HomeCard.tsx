import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { DirectionalChevron } from "@/components/DirectionalChevron";
import { isolateNumeric } from "@/features/events/format";
import { summarizeFamilyStatus } from "@/features/safe/family-status";
import { useFamilyCheckIns } from "@/features/safe/hooks";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";
import { parseVcRange } from "../assessment";
import { displayVcRange } from "../format";
import { useFamily, type HomeSummary } from "../queries";
import { VcBadge } from "./VcBadge";

/** Small bordered pill: meaning is always in its text (and icon), never colour. */
export function Chip({
  text,
  icon,
  accessibilityLabel,
  testID,
}: {
  text: string;
  icon?: keyof typeof Ionicons.glyphMap;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const { colors, typography } = useTheme();
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={accessibilityLabel ?? text}
      style={[
        styles.chip,
        { backgroundColor: colors.surface.sunken, borderColor: colors.border.default },
      ]}
    >
      {icon ? <Ionicons name={icon} size={16} color={colors.text.secondary} /> : null}
      <Text style={[typography.bodyMeta, { color: colors.text.secondary }]}>{text}</Text>
    </View>
  );
}

/**
 * One tagged home on the My account page. The body (class badge, name, code,
 * a chip row) opens the building report; the footer row opens the family.
 * The members chip shares its query with the Family screen, so opening the
 * family afterwards is instant.
 */
export function HomeCard({ home }: { home: HomeSummary }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const { tag, assessment, role } = home;
  const family = useFamily(tag.tagId, role === "owner");
  const approved = (family.data?.members ?? []).filter((m) => m.status === "approved");
  // "3 of 4 checked in" for the latest earthquake somebody here checked in
  // for (last 24 hours). Hidden when there is none or it cannot be loaded.
  const checkIns = useFamilyCheckIns(tag.tagId);
  const safeSummary = checkIns.data ? summarizeFamilyStatus(checkIns.data) : null;
  const range = parseVcRange(assessment?.vcRange);
  const rangeText =
    range && range.from !== range.to ? displayVcRange(assessment?.vcRange) : null;
  const title = tag.label ?? t(`building.kinds.${tag.kind}`);

  return (
    <View
      testID={`home-card-${tag.tagId}`}
      style={[
        styles.card,
        { backgroundColor: colors.surface.raised, borderColor: colors.border.default },
      ]}
    >
      <Pressable
        testID={`home-report-${tag.tagId}`}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${tag.code}`}
        onPress={() =>
          router.push({ pathname: "/home/[tagId]/report", params: { tagId: tag.tagId } })
        }
        style={({ pressed }) => [
          styles.body,
          {
            padding: spacing[4],
            gap: spacing[3],
            backgroundColor: pressed ? colors.surface.sunken : "transparent",
          },
        ]}
      >
        {assessment ? (
          <VcBadge
            vc={assessment.vcMostLikely}
            size={56}
            label={t("building.report.vcLabel", { vc: assessment.vcMostLikely })}
            testID={`home-vc-${tag.tagId}`}
          />
        ) : null}
        <View style={[styles.bodyText, { gap: spacing[1] }]}>
          <Text style={[typography.bodyDefault, { color: colors.text.primary }]}>
            {title}
          </Text>
          <Text
            style={[
              typography.bodyMeta,
              {
                color: colors.text.secondary,
                writingDirection: "ltr",
                textAlign: "auto",
              },
            ]}
          >
            {isolateNumeric(tag.code)}
          </Text>
          <View style={[styles.chips, { gap: spacing[2] }]}>
            {approved.length > 0 ? (
              <Chip
                testID={`home-members-${tag.tagId}`}
                icon="people-outline"
                text={localizeDigits(String(approved.length), i18n.language)}
                accessibilityLabel={t("myData.home.members", {
                  count: localizeDigits(String(approved.length), i18n.language),
                })}
              />
            ) : null}
            {safeSummary?.focus ? (
              <Chip
                testID={`home-safe-${tag.tagId}`}
                icon="checkmark-circle-outline"
                text={t("imSafe.family.summary", {
                  n: localizeDigits(String(safeSummary.checkedIn), i18n.language),
                  total: localizeDigits(String(safeSummary.total), i18n.language),
                })}
                accessibilityLabel={t("imSafe.family.summaryA11y", {
                  n: localizeDigits(String(safeSummary.checkedIn), i18n.language),
                  total: localizeDigits(String(safeSummary.total), i18n.language),
                })}
              />
            ) : null}
            {assessment && rangeText ? (
              <Chip
                text={isolateNumeric(rangeText)}
                accessibilityLabel={t("building.report.range", { range: rangeText })}
              />
            ) : null}
            {!assessment ? <Chip text={t("building.report.noReport")} /> : null}
          </View>
        </View>
        <DirectionalChevron />
      </Pressable>
      <Pressable
        testID={`home-family-${tag.tagId}`}
        accessibilityRole="button"
        accessibilityLabel={t("building.report.family")}
        onPress={() =>
          router.push({ pathname: "/home/[tagId]/family", params: { tagId: tag.tagId } })
        }
        style={({ pressed }) => [
          styles.footer,
          {
            paddingHorizontal: spacing[4],
            gap: spacing[3],
            borderTopColor: colors.border.subtle,
            backgroundColor: pressed ? colors.surface.sunken : "transparent",
          },
        ]}
      >
        <Ionicons name="people" size={22} color={colors.text.secondary} />
        <Text
          style={[
            typography.bodyDefault,
            styles.footerLabel,
            { color: colors.text.primary },
          ]}
        >
          {t("building.report.family")}
        </Text>
        <DirectionalChevron />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  body: { flexDirection: "row", alignItems: "center" },
  bodyText: { flex: 1 },
  chips: { flexDirection: "row", flexWrap: "wrap" },
  chip: {
    minHeight: 28,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  footer: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
  },
  footerLabel: { flex: 1 },
});
