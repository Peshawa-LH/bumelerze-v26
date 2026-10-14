import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import {
  enqueueTier2Report,
  Tier2OptionButton,
  Tier2ScreenShell,
  TIER2_QUESTIONS,
  useFeltQueueStore,
  useTier2DraftStore,
  type CartoonLevel,
  type DamageLevel,
  type FeltAnswer,
  type Tier2QuestionDef,
} from "@/features/felt";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";

/**
 * The cartoon level that means "Not felt" (`felt.tier1.levels.1`). Window 1
 * already asked the person how strongly they felt it, so the questionnaire's
 * own "Did you feel the earthquake?" is answered from that pick instead of
 * being asked again seconds later (A-13).
 */
const NOT_FELT_LEVEL: CartoonLevel = 1;

function feltAnswerFromLevel(level: CartoonLevel): FeltAnswer {
  return level === NOT_FELT_LEVEL ? "no" : "yes";
}

/** The questions actually shown: every tier-2 question, minus the "felt"
 * one when window 1 already answered it. Order is the science pack's. */
function askedQuestions(feltKnown: boolean): readonly Tier2QuestionDef[] {
  return feltKnown ? TIER2_QUESTIONS.filter((question) => question.field !== "felt") : TIER2_QUESTIONS;
}

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
 *
 * The route's `step` stays the index into `TIER2_QUESTIONS` (the science
 * numbering); what the person sees is "Step {{current}} of {{total}}" over
 * the questions actually asked, and the "felt" question is pre-answered
 * from the window-1 level and stepped over whenever that level is known
 * (the queued tier-1 report for `feltReportId`). The question keeps its
 * string for the standalone path, where no level exists.
 */
export default function Tier2StepScreen() {
  const { step, feltReportId, eventId } = useLocalSearchParams<{
    step: string;
    feltReportId: string;
    eventId?: string;
  }>();
  const { t, i18n } = useTranslation();
  const { spacing } = useTheme();
  const router = useRouter();

  const stepIndex = Number(step);
  const question = TIER2_QUESTIONS[stepIndex];

  const initDraft = useTier2DraftStore((state) => state.initDraft);
  const setAnswer = useTier2DraftStore((state) => state.setAnswer);
  const tier1Level = useFeltQueueStore(
    (state) =>
      state.items.find((item) => item.tier1.reportId === feltReportId)?.tier1.cartoonLevel ?? null,
  );
  const feltKnown = tier1Level !== null;
  const asked = askedQuestions(feltKnown);

  useEffect(() => {
    if (feltReportId) {
      initDraft(feltReportId, eventId || null);
    }
  }, [feltReportId, eventId, initDraft]);

  // Landing on the pre-answered question (e.g. a stale link): record the
  // window-1 answer and move on without rendering it.
  useEffect(() => {
    if (question?.field === "felt" && tier1Level !== null) {
      setAnswer("felt", feltAnswerFromLevel(tier1Level));
      router.replace({
        pathname: "/felt-report/step/[step]",
        params: { step: String(stepIndex + 1), feltReportId, eventId: eventId ?? "" },
      });
    }
  }, [question, tier1Level, setAnswer, router, stepIndex, feltReportId, eventId]);

  if (!question || (question.field === "felt" && feltKnown)) {
    // Defensive only — every link into this route is built from
    // TIER2_QUESTIONS.length by this same module, so an out-of-range step
    // should never actually happen; the pre-answered question is being
    // stepped over by the effect above.
    return null;
  }

  // Re-bound so the nested closures below (handleSelect, the options map)
  // keep TS's non-null narrowing — control-flow narrowing on `question`
  // itself doesn't extend into function expressions declared after the
  // guard above.
  const currentQuestion = question;

  async function goToStep(nextIndex: number) {
    const next = TIER2_QUESTIONS[nextIndex];
    if (next && next.field === "felt" && tier1Level !== null) {
      // Window 1 already answered this one: record it and step over it.
      setAnswer("felt", feltAnswerFromLevel(tier1Level));
      await goToStep(nextIndex + 1);
      return;
    }
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

  const position = asked.indexOf(currentQuestion);
  const progress = t("felt.tier2.progress", {
    current: localizeDigits(String(position + 1), i18n.language),
    total: localizeDigits(String(asked.length), i18n.language),
  });

  return (
    <Tier2ScreenShell
      currentIndex={position}
      totalSteps={asked.length}
      title={t(`felt.tier2.questions.${currentQuestion.i18nKey}.title`)}
      description={progress}
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
