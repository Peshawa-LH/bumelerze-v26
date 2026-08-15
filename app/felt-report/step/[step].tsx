import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import {
  enqueueTier2Report,
  Tier2OptionButton,
  Tier2ScreenShell,
  TIER2_QUESTIONS,
  useTier2DraftStore,
  type DamageLevel,
} from "@/features/felt";
import { useTheme } from "@/theme";

/**
 * One tier-2 question per screen (spec-v1.md §4.6 — Q1-Q9/Q11,
 * `felt-report-science-v1.md` PART 2; Q10 removed, 2026-08-15 flow
 * restructure — see `questions.ts`). Tapping an option both records the
 * answer and advances; the "Skip" footer advances without recording one
 * (every question is independently skippable). Reached only via window 3's
 * "Add more detail" — damage (window 2) and comment/photo (window 3) are
 * already in the shared draft by the time this screen ever mounts. The
 * LAST question submits directly (there is no separate comment step
 * anymore) and hands off to the shared `done` screen.
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

  async function goToStep(nextIndex: number) {
    if (nextIndex < TIER2_QUESTIONS.length) {
      router.push({
        pathname: "/felt-report/step/[step]",
        params: { step: String(nextIndex), feltReportId, eventId: eventId ?? "" },
      });
      return;
    }

    // Last question answered/skipped — submit the full draft (damage +
    // comment/photo from windows 2/3, plus every Q1-Q9/Q11 answer just
    // collected) and land on the shared completion screen. Read straight
    // from the store rather than closed-over props: `setAnswer` above
    // already committed synchronously, so `getState()` here is guaranteed
    // current.
    const draft = useTier2DraftStore.getState();
    await enqueueTier2Report({
      feltReportId,
      answers: draft.answers,
      photoUri: draft.photoUri,
    });
    draft.reset();
    router.replace({
      pathname: "/felt-report/done",
      params: { feltReportId, eventId: eventId ?? "" },
    });
  }

  function handleBack() {
    if (router.canGoBack()) {
      router.back();
    }
  }

  function handleSkip() {
    void goToStep(stepIndex + 1);
  }

  function handleSelect(value: string | DamageLevel) {
    // `field`/`value` pairing is enforced by TIER2_QUESTIONS' own shape —
    // the one remaining "damage" question (Q11, road damage) always
    // carries DamageLevel options, a "choice" question always carries its
    // field's string union.
    setAnswer(currentQuestion.field as never, value as never);
    void goToStep(stepIndex + 1);
  }

  return (
    <Tier2ScreenShell
      currentIndex={stepIndex}
      totalSteps={TIER2_QUESTIONS.length}
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
