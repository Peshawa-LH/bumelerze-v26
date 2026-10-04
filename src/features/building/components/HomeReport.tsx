import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AccountButton } from "@/features/account/components/AccountButton";
import { isolateNumeric } from "@/features/events/format";
import { useTheme } from "@/theme";
import {
  expectedDamageTable,
  improvementTips,
  parseVcRange,
  plainTypeKey,
  rankedTypes,
} from "../assessment";
import { displayVcRange, formatPercent, formatPga, formatVs30 } from "../format";
import { useHome, useHomePhotos } from "../queries";
import type { HomeTag, StoredAssessment } from "../types";
import { AccountGate } from "./AccountGate";
import { Body, Card, Heading, Meta, ScreenFrame } from "./ui";
import { VcBadge } from "./VcBadge";

/** Share of the second most likely type above which the report mentions it. */
const SECOND_TYPE_MIN = 0.25;

/** The report screen of one home: gate, loading and not-found states around
 * the report itself. */
export function HomeReportScreen({ tagId }: { tagId: string | undefined }) {
  const { t } = useTranslation();
  return (
    <ScreenFrame title={t("building.report.title")}>
      <AccountGate>
        <ReportBody tagId={tagId} />
      </AccountGate>
    </ScreenFrame>
  );
}

function ReportBody({ tagId }: { tagId: string | undefined }) {
  const { t } = useTranslation();
  const home = useHome(tagId);
  const photos = useHomePhotos(tagId);

  if (home.isLoading) {
    return <Body tone="secondary">{t("building.loading")}</Body>;
  }
  if (home.isError) {
    return (
      <Card>
        <Body>{t("building.section.loadError")}</Body>
        <AccountButton
          label={t("building.section.retry")}
          onPress={() => void home.refetch()}
        />
      </Card>
    );
  }
  if (!home.data?.tag || !tagId) {
    return <Body tone="secondary">{t("building.report.notAvailable")}</Body>;
  }
  return (
    <Report
      tag={home.data.tag}
      assessment={home.data.assessment}
      photos={photos}
      tagId={tagId}
    />
  );
}

export function Report({
  tag,
  assessment,
  photos,
  tagId,
}: {
  tag: HomeTag;
  assessment: StoredAssessment | null;
  photos: string[];
  tagId: string;
}) {
  const { t, i18n } = useTranslation();
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const locale = i18n.language;

  const header = (
    <Card testID="report-header">
      <Meta>{t("building.report.codeLabel")}</Meta>
      <Heading level={1}>{isolateNumeric(tag.code)}</Heading>
      {tag.label ? <Body>{tag.label}</Body> : null}
      {tag.unitLabel ? <Meta>{tag.unitLabel}</Meta> : null}
    </Card>
  );

  const actions = (
    <View style={{ gap: spacing[3] }}>
      <AccountButton
        label={t("building.report.family")}
        onPress={() =>
          router.push({ pathname: "/home/[tagId]/family", params: { tagId } })
        }
        testID="report-family"
      />
      <AccountButton
        tone={assessment ? "secondary" : "primary"}
        label={assessment ? t("building.report.retake") : t("building.report.start")}
        onPress={() => router.push({ pathname: "/home/new", params: { tagId } })}
        testID="report-retake"
      />
    </View>
  );

  if (!assessment) {
    return (
      <View style={{ gap: spacing[4] }}>
        {header}
        <Body tone="secondary">{t("building.report.noReport")}</Body>
        {actions}
      </View>
    );
  }

  const vc = assessment.vcMostLikely;
  const range = parseVcRange(assessment.vcRange);
  const rangeText = displayVcRange(assessment.vcRange);
  const ranked = rankedTypes(assessment.imsTypeProbs);
  const top = ranked[0];
  const second = ranked[1];
  const hazard = assessment.hazard;
  const table = expectedDamageTable(vc);
  const tips = improvementTips(assessment.imsTypeProbs);
  const showRange = range !== null && range.from !== range.to;

  return (
    <View style={{ gap: spacing[4] }}>
      {header}

      <Card testID="report-vc">
        <View style={[styles.vcRow, { gap: spacing[4] }]}>
          <VcBadge
            vc={vc}
            size={96}
            label={t("building.report.vcLabel", { vc })}
            testID="report-vc-badge"
          />
          <View style={styles.vcText}>
            <Heading level={3}>{t(`building.vc.name.${vc}`)}</Heading>
            <Body tone="secondary">{t(`building.vc.meaning.${vc}`)}</Body>
          </View>
        </View>
        {showRange && rangeText ? (
          <Meta testID="report-range">
            {t("building.report.range", { range: rangeText })}
          </Meta>
        ) : null}
        {assessment.confidence !== null ? (
          <Meta testID="report-confidence">
            {t("building.report.confidence", {
              value: formatPercent(assessment.confidence, locale),
            })}
          </Meta>
        ) : null}
      </Card>

      {top ? (
        <Card testID="report-type">
          <Heading level={3}>{t("building.report.typeTitle")}</Heading>
          <Body>{t(`building.types.${plainTypeKey(top.type)}`)}</Body>
          {second && second.probability >= SECOND_TYPE_MIN ? (
            <Meta>
              {t("building.report.alsoPossible", {
                type: t(`building.types.${plainTypeKey(second.type)}`),
              })}
            </Meta>
          ) : null}
          <Meta>{t("building.report.imsType", { type: top.type })}</Meta>
        </Card>
      ) : null}

      <Card testID="report-ground">
        <Heading level={3}>{t("building.report.groundTitle")}</Heading>
        {hazard && hazard.site_class && hazard.vs30 !== null ? (
          <Body>
            {t("building.report.ground", {
              siteClass: hazard.site_class,
              vs30: formatVs30(hazard.vs30, locale),
            })}
          </Body>
        ) : (
          <Body tone="secondary">{t("building.report.groundUnknown")}</Body>
        )}
        {hazard && hazard.pga_g !== null ? (
          <Body>
            {t("building.report.pga", {
              pga: formatPga(hazard.pga_g, locale),
              zone: hazard.zone ?? "-",
            })}
          </Body>
        ) : (
          <Body tone="secondary">{t("building.report.pgaUnknown")}</Body>
        )}
        <Meta>
          {t("building.report.hazardSource", { source: hazard?.source ?? "ISC-2025" })}
        </Meta>
      </Card>

      <Card testID="report-damage">
        <Heading level={3}>{t("building.report.damageTitle")}</Heading>
        {table.map(({ intensity, damage }) => (
          <View
            key={intensity}
            style={{ gap: spacing[1] }}
            testID={`damage-${intensity}`}
          >
            <Body>{t(`building.damage.intensity.${intensity}`)}</Body>
            {damage.length === 0 ? (
              <Meta>{t("building.damage.none")}</Meta>
            ) : (
              damage.map((entry) => (
                <Meta key={`${entry.grade}-${entry.quantity}`}>
                  {t(`building.damage.${entry.quantity}`, {
                    what: t(`building.damage.grade.${entry.grade}`),
                  })}
                </Meta>
              ))
            )}
          </View>
        ))}
        <Meta>{t("building.damage.note")}</Meta>
      </Card>

      <Card testID="report-tips">
        <Heading level={3}>{t("building.report.tipsTitle")}</Heading>
        {tips.map((key) => (
          <Body key={key}>{`• ${t(key)}`}</Body>
        ))}
        <AccountButton
          label={t("building.report.safety")}
          onPress={() => router.push("/safety")}
          testID="report-safety"
        />
      </Card>

      {photos.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          testID="report-photos"
        >
          <View style={{ flexDirection: "row", gap: spacing[2] }}>
            {photos.map((uri) => (
              <Image
                key={uri}
                source={{ uri }}
                contentFit="cover"
                accessibilityLabel={t("building.report.photo")}
                style={[styles.photo, { backgroundColor: colors.surface.sunken }]}
              />
            ))}
          </View>
        </ScrollView>
      ) : null}

      <Meta testID="report-disclaimer">
        {assessment.reviewStatus === "engineer_reviewed"
          ? t("building.report.reviewed")
          : t("building.report.automatic")}
      </Meta>
      {actions}
    </View>
  );
}

const styles = StyleSheet.create({
  vcRow: { flexDirection: "row", alignItems: "center" },
  vcText: { flex: 1, gap: 4 },
  photo: { width: 140, height: 140, borderRadius: 10 },
});
