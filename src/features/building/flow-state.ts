import { PHOTO_SLOTS, type PhotoSlot } from "./photos";
import {
  QUESTIONS,
  pruneAnswers,
  visibleQuestions,
  type Answers,
  type QuestionId,
} from "./questionnaire";
import type { HomeKind, LocationQuality } from "./types";

/**
 * Pure state machine of the "Tag my building" flow: which screen comes next
 * and previous, and how far along the user is. No React in here.
 *
 *   new:    kind -> location -> questions... -> photos -> review
 *   retake: questions... -> review
 */

export type FlowMode = "new" | "retake";
export type FlowStep = "kind" | "location" | "question" | "photos" | "review";

export interface FlowLocation {
  lat: number;
  lon: number;
  quality: LocationQuality;
  /** The place picked in the place search (quality "town"); local only. */
  placeId?: string;
}

export interface FlowState {
  mode: FlowMode;
  step: FlowStep;
  kind: HomeKind | null;
  label: string;
  unitLabel: string;
  location: FlowLocation | null;
  answers: Answers;
  /** The question being shown when `step` is "question". */
  questionId: QuestionId;
  /** Entered from the review screen: Next returns there. */
  editing: boolean;
  photos: Partial<Record<PhotoSlot, string>>;
}

const FIRST_QUESTION: QuestionId = (QUESTIONS[0] as { id: QuestionId }).id;

export function initialFlowState(
  mode: FlowMode = "new",
  answers: Answers = {},
): FlowState {
  return {
    mode,
    step: mode === "new" ? "kind" : "question",
    kind: null,
    label: "",
    unitLabel: "",
    location: null,
    answers: pruneAnswers(answers),
    questionId: FIRST_QUESTION,
    editing: false,
    photos: {},
  };
}

export type StepRef = { step: FlowStep; questionId?: QuestionId };

/** Every screen of the flow in order, for the answers so far. */
export function sequence(state: Pick<FlowState, "mode" | "answers">): StepRef[] {
  const steps: StepRef[] = [];
  if (state.mode === "new") {
    steps.push({ step: "kind" }, { step: "location" });
  }
  for (const question of visibleQuestions(state.answers)) {
    steps.push({ step: "question", questionId: question.id });
  }
  if (state.mode === "new") {
    steps.push({ step: "photos" });
  }
  steps.push({ step: "review" });
  return steps;
}

function indexOfCurrent(state: FlowState, steps: StepRef[]): number {
  return steps.findIndex(
    (ref) =>
      ref.step === state.step &&
      (ref.step !== "question" || ref.questionId === state.questionId),
  );
}

/** 1-based position and total, for the progress bar. */
export function progress(state: FlowState): { current: number; total: number } {
  const steps = sequence(state);
  const index = indexOfCurrent(state, steps);
  return { current: Math.max(index, 0) + 1, total: steps.length };
}

function moveTo(state: FlowState, ref: StepRef, editing: boolean): FlowState {
  return {
    ...state,
    step: ref.step,
    questionId: ref.questionId ?? state.questionId,
    editing,
  };
}

export function isOptionalQuestion(id: QuestionId): boolean {
  return QUESTIONS.find((question) => question.id === id)?.optional === true;
}

/** Whether the current screen has what it needs for "Next". */
export function canAdvance(state: FlowState): boolean {
  switch (state.step) {
    case "kind":
      return state.kind !== null;
    case "location":
      return state.location !== null;
    case "question":
      return (
        isOptionalQuestion(state.questionId) ||
        state.answers[state.questionId] !== undefined
      );
    default:
      return true;
  }
}

export function goNext(state: FlowState): FlowState {
  if (!canAdvance(state)) {
    return state;
  }
  const steps = sequence(state);
  if (state.editing) {
    // After an edit from the review screen: any newly relevant question that
    // is still unanswered comes first, otherwise straight back to review.
    const unanswered = steps.find(
      (ref) =>
        ref.step === "question" &&
        !isOptionalQuestion(ref.questionId as QuestionId) &&
        state.answers[ref.questionId as QuestionId] === undefined,
    );
    return unanswered
      ? moveTo(state, unanswered, true)
      : moveTo(state, { step: "review" }, false);
  }
  const next = steps[indexOfCurrent(state, steps) + 1];
  return next ? moveTo(state, next, false) : state;
}

/** The previous screen, or null when Back should leave the flow. */
export function goBack(state: FlowState): FlowState | null {
  if (state.editing) {
    return moveTo(state, { step: "review" }, false);
  }
  const steps = sequence(state);
  const index = indexOfCurrent(state, steps);
  const previous = steps[index - 1];
  return previous ? moveTo(state, previous, false) : null;
}

/** Jump from the review screen to one item to change it. */
export function editStep(state: FlowState, ref: StepRef): FlowState {
  return moveTo(state, ref, true);
}

export function setAnswer(state: FlowState, id: QuestionId, value: string): FlowState {
  return { ...state, answers: pruneAnswers({ ...state.answers, [id]: value }) };
}

export function setPhoto(
  state: FlowState,
  slot: PhotoSlot,
  uri: string | null,
): FlowState {
  const photos = { ...state.photos };
  if (uri === null) {
    delete photos[slot];
  } else {
    photos[slot] = uri;
  }
  return { ...state, photos };
}

/** Picked photo uris in slot order. */
export function photoList(state: FlowState): string[] {
  return PHOTO_SLOTS.flatMap((slot) => {
    const uri = state.photos[slot];
    return uri ? [uri] : [];
  });
}
