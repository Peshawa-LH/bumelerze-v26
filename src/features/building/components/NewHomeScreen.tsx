import { useTranslation } from "react-i18next";

import { useAccount } from "@/features/account/use-account";
import { answersFromSurvey } from "../service";
import { useHome, useLatestSurvey } from "../queries";
import { AccountGate } from "./AccountGate";
import { TagFlow } from "./TagFlow";
import { Body, ScreenFrame } from "./ui";

/** Entry of "Tag my building" (no `tagId`) and of "Retake the questions"
 * (`tagId` of an existing home, answers prefilled from its last survey). */
export function NewHomeScreen({ tagId }: { tagId?: string | undefined }) {
  const { t } = useTranslation();
  const account = useAccount();

  if (account.status !== "account") {
    return (
      <ScreenFrame title={t("building.title")}>
        <AccountGate>{null}</AccountGate>
      </ScreenFrame>
    );
  }
  return tagId ? <Retake tagId={tagId} /> : <TagFlow />;
}

function Retake({ tagId }: { tagId: string }) {
  const { t } = useTranslation();
  const home = useHome(tagId);
  const { survey, isLoading } = useLatestSurvey(tagId);

  if (home.isLoading || isLoading) {
    return (
      <ScreenFrame title={t("building.report.retake")}>
        <Body tone="secondary">{t("building.loading")}</Body>
      </ScreenFrame>
    );
  }
  const tag = home.data?.tag;
  if (!tag) {
    return (
      <ScreenFrame title={t("building.report.retake")}>
        <Body tone="secondary">{t("building.report.notAvailable")}</Body>
      </ScreenFrame>
    );
  }
  return (
    <TagFlow
      key={survey?.surveyId ?? "fresh"}
      retake={{ tag, answers: survey ? answersFromSurvey(survey.answers) : {} }}
    />
  );
}
