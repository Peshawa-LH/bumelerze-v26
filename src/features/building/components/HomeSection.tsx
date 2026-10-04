import { useRouter } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { AccountButton } from "@/features/account/components/AccountButton";
import { useAccount } from "@/features/account/use-account";
import { isolateNumeric } from "@/features/events/format";
import { useTheme } from "@/theme";
import { parseVcRange } from "../assessment";
import { displayVcRange } from "../format";
import { MAX_HOMES_PER_ACCOUNT } from "../constants";
import { useMyHomes, type HomeSummary } from "../queries";
import { Body, Card, Heading, Meta } from "./ui";
import { VcBadge } from "./VcBadge";

/**
 * "My home" on the My account screen. Anonymous installs get the account
 * gate card; accounts see their tagged homes (or the "Tag my building"
 * button) and a "Join a home" link. Hidden while no Supabase project is
 * configured.
 */
export function HomeSection() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const router = useRouter();
  const account = useAccount();
  const mine = useMyHomes();

  if (account.status === "unconfigured" || account.status === "loading") {
    return null;
  }

  const title = <Heading level={3}>{t("building.section.title")}</Heading>;

  if (account.status !== "account") {
    return (
      <Card testID="home-section-gate">
        {title}
        <Body tone="secondary">{t("building.gate.title")}</Body>
        <AccountButton
          tone="primary"
          label={t("building.gate.cta")}
          onPress={() => router.push("/account/sign-in")}
          testID="home-section-sign-in"
        />
      </Card>
    );
  }

  const homes = mine.data?.homes ?? [];
  const pending = mine.data?.pendingRequests ?? 0;
  const canTagMore =
    homes.filter((home) => home.role === "owner").length < MAX_HOMES_PER_ACCOUNT;

  return (
    <View style={{ gap: spacing[3] }} testID="home-section">
      {title}
      {mine.isLoading ? <Meta>{t("building.loading")}</Meta> : null}
      {mine.isError ? (
        <Card>
          <Body>{t("building.section.loadError")}</Body>
          <AccountButton
            label={t("building.section.retry")}
            onPress={() => void mine.refetch()}
          />
        </Card>
      ) : null}
      {homes.map((home) => (
        <HomeCard key={home.tag.tagId} home={home} />
      ))}
      {pending > 0 ? (
        <Meta testID="home-pending">{t("building.section.pending")}</Meta>
      ) : null}
      {!mine.isLoading && !mine.isError && homes.length === 0 ? (
        <Body tone="secondary">{t("building.section.empty")}</Body>
      ) : null}
      {canTagMore && !mine.isLoading ? (
        <AccountButton
          tone={homes.length === 0 ? "primary" : "secondary"}
          label={
            homes.length === 0 ? t("building.title") : t("building.section.tagAnother")
          }
          onPress={() => router.push("/home/new")}
          testID="home-tag"
        />
      ) : null}
      <AccountButton
        label={t("building.section.join")}
        onPress={() => router.push("/home/join")}
        testID="home-join"
      />
    </View>
  );
}

function HomeCard({ home }: { home: HomeSummary }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { spacing } = useTheme();
  const { tag, assessment } = home;
  const range = parseVcRange(assessment?.vcRange);
  const rangeText =
    range && range.from !== range.to ? displayVcRange(assessment?.vcRange) : null;
  return (
    <Card testID={`home-card-${tag.tagId}`}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[3] }}>
        {assessment ? (
          <VcBadge
            vc={assessment.vcMostLikely}
            size={56}
            label={t("building.report.vcLabel", { vc: assessment.vcMostLikely })}
            testID={`home-vc-${tag.tagId}`}
          />
        ) : null}
        <View style={{ flex: 1, gap: 2 }}>
          <Body>{tag.label ?? t(`building.kinds.${tag.kind}`)}</Body>
          <Meta>{isolateNumeric(tag.code)}</Meta>
          {assessment && rangeText ? (
            <Meta>{t("building.report.range", { range: rangeText })}</Meta>
          ) : null}
          {!assessment ? <Meta>{t("building.report.noReport")}</Meta> : null}
        </View>
      </View>
      <AccountButton
        tone="primary"
        label={t("building.section.viewReport")}
        onPress={() =>
          router.push({ pathname: "/home/[tagId]/report", params: { tagId: tag.tagId } })
        }
        testID={`home-report-${tag.tagId}`}
      />
      <AccountButton
        label={t("building.report.family")}
        onPress={() =>
          router.push({ pathname: "/home/[tagId]/family", params: { tagId: tag.tagId } })
        }
        testID={`home-family-${tag.tagId}`}
      />
    </Card>
  );
}
