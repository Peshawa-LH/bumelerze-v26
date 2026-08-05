import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import {
  Tier2OptionButton,
  Tier2ScreenShell,
  TIER2_QUESTIONS,
  useTier2DraftStore,
  type DamageLevel,
} from "@/features/felt";
import { useTheme } from "@/theme";

/**
 * One tier-2 question per screen (spec-v1.md §4.6 — Q1-Q11,
 * `felt-report-science-v1.md` PART 2). Tapping an option both records the
 * answer and advances; the "Skip" footer advances without recording one
 * (every question is independently skippable). The last question hands off
 * to `app/felt-report/comment.tsx` instead of another step.
 */
export default function Tier2StepScreen() {
  const { step, feltReportId, eventId } = useLocalSearchParams<{
    step: string;
    feltReportId: string;
    eventId?: string;
  }>();
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const router = useRouter();

  const stepIndex = Number(step);
  const question = TIER2_QUESTIONS[stepIndex];

  const initDraft = useTier2DraftStore((state) => state.initDraft);
  const setAnswer = useTier2DraftStore((state) => state.setAnswer);

  useEffect(() => {
    if (feltReportId) {
      initDraft(feltReportId, eventId || null);
    }
  }, [feltReportId, eventId, initDraft]);

  if (!question) {
    // Defensive only — every link into this route is built from
    // TIER2_QUESTIONS.length by this same module, so an out-of-range step
    // should never actually happen.
    return null;
  }

  // Re-bound so the nested closures below (handleSelect, the options map)
  // keep TS's non-null narrowing — control-flow narrowing on `question`
  // itself doesn't extend into function expressions declared after the
  // guard above.
  const currentQuestion = question;

  function goToStep(nextIndex: number) {
    if (nextIndex < TIER2_QUESTIONS.length) {
      router.push({
        pathname: "/felt-report/step/[step]",
        params: { step: String(nextIndex), feltReportId, eventId: eventId ?? "" },
      });
    } else {
      router.push({
        pathname: "/felt-report/comment",
        params: { feltReportId, eventId: eventId ?? "" },
      });
    }
  }

  function handleBack() {
    if (router.canGoBack()) {
      router.back();
    }
  }

  function handleSkip() {
    goToStep(stepIndex + 1);
  }

  function handleSelect(value: string | DamageLevel) {
    // `field`/`value` pairing is enforced by TIER2_QUESTIONS' own shape —
    // a "damage" question always carries DamageLevel options, a "choice"
    // question always carries its field's string union.
    setAnswer(currentQuestion.field as never, value as never);
    goToStep(stepIndex + 1);
  }

  return (
    <Tier2ScreenShell
      currentIndex={stepIndex}
      totalSteps={TIER2_QUESTIONS.length + 1}
      title={t(`felt.tier2.questions.${currentQuestion.i18nKey}.title`)}
      onBack={handleBack}
      onSkip={handleSkip}
    >
      <View style={{ gap: spacing[2] }}>
        {currentQuestion.options.map((option) => (
          <Tier2OptionButton
            key={String(option)}
            label={t(`felt.tier2.questions.${currentQuestion.i18nKey}.options.${option}`)}
            onPress={() => handleSelect(option)}
          />
        ))}
      </View>
    </Tier2ScreenShell>
  );
}
